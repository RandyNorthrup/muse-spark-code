import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.VerifyPluginTask
import java.io.File

plugins {
  kotlin("jvm") version "2.2.20"
  id("org.jetbrains.intellij.platform") version "2.19.0"
  id("org.jlleitschuh.gradle.ktlint") version "13.1.0"
  id("io.gitlab.arturbosch.detekt") version "1.23.8"
}

group = "io.github.randynorthrup.musespark"
// The plugin ships with the product: one version, the repository's package.json.
version =
  Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(providers.fileContents(layout.projectDirectory.file("../../package.json")).asText.get())
    ?.groupValues
    ?.get(1) ?: error("package.json has no version")

repositories {
  mavenCentral()
  intellijPlatform { defaultRepositories() }
}

dependencies {
  intellijPlatform {
    val privateIdePath = providers.gradleProperty("privateIdePath")
    if (privateIdePath.isPresent) local(privateIdePath.get()) else intellijIdea("2025.3.3")
    testFramework(TestFrameworkType.Platform)
    pluginVerifier("1.410")
  }
  testImplementation("junit:junit:4.13.2")
}

kotlin {
  jvmToolchain(21)
  compilerOptions { jvmDefault = org.jetbrains.kotlin.gradle.dsl.JvmDefaultMode.NO_COMPATIBILITY }
}
ktlint { version = "1.7.1" }
detekt {
  buildUponDefaultConfig = true
  config.setFrom(files("detekt.yml"))
}

intellijPlatform {
  pluginConfiguration {
    name = "Muse Spark Code (Unofficial)"
    ideaVersion {
      sinceBuild = "253"
      untilBuild = "262.*"
    }
  }
  pluginVerification {
    failureLevel.set(VerifyPluginTask.FailureLevel.ALL)
    ides {
      val localIdes = providers.gradleProperty("verificationIdePaths").orNull
      if (localIdes == null) {
        for (release in listOf("2025.3.3", "2026.1.5", "2026.2.3")) {
          create("IU", release) { useInstaller = true }
        }
      } else {
        localIdes.split(File.pathSeparator).forEach { local(it) }
      }
    }
  }
}

val repositoryRoot = rootDir.resolve("../..").canonicalFile
val renderPages by tasks.registering(Exec::class) {
  inputs.files(repositoryRoot.resolve("dist/whatsNew.json"), repositoryRoot.resolve("dist/uiText.js"))
  inputs.dir(repositoryRoot.resolve("l10n"))
  inputs.dir(repositoryRoot.resolve("dist/webview"))
  inputs.files(
    file("build-resources.mjs"),
    file("check-bundle-size.mjs"),
    file("src/main/resources/nativeModules.mjs"),
    repositoryRoot.resolve("src/host/html.ts"),
    repositoryRoot.resolve("src/host/whatsNew/whatsNewHtml.ts"),
  )
  outputs.dir(layout.buildDirectory.dir("generated/pages"))
  commandLine("node", file("build-resources.mjs").absolutePath)
}
val sharedResources by tasks.registering(Sync::class) {
  dependsOn(renderPages)
  from(repositoryRoot.resolve("src/shared/hostApi/mhp-v1.1.schema.json")) { into("mhp") }
  from(repositoryRoot.resolve("src/shared/hostApi/mhp-v1.1.lock.json")) { into("mhp") }
  from(repositoryRoot.resolve("dist/webview")) {
    into("webview")
    include("*.css", "portable/**")
  }
  from(listOf(repositoryRoot.resolve("LICENSE"), repositoryRoot.resolve("THIRD_PARTY_NOTICES.txt"))) { into("legal") }
  from(repositoryRoot.resolve("l10n")) { into("l10n") }
  from(layout.buildDirectory.dir("generated/pages")) {
    into("pages")
    exclude("renderer.mjs")
  }
  into(layout.buildDirectory.dir("generated/shared"))
  doFirst {
    check(repositoryRoot.resolve("dist/webview/main.js").isFile) {
      "Build the shared panel with npm run build before packaging the plugin"
    }
  }
}
sourceSets.main { resources.srcDir(sharedResources) }
// Compile the production Eclipse mapper beside Kotlin for executable schema parity.
val eclipseErrorMapper by tasks.registering(Sync::class) {
  from(repositoryRoot.resolve("hosts/eclipse/plugin/src/io/musespark/eclipse/MhpErrors.java"))
  into(layout.buildDirectory.dir("generated/errorParity"))
}
sourceSets.test {
  java.srcDir(repositoryRoot.resolve("test/m104/linux/jetbrains"))
  java.srcDir(eclipseErrorMapper)
}

tasks.test {
  maxParallelForks = 1
  maxHeapSize = "1024m"
  val nativeUi = providers.gradleProperty("nativeUi").map(String::toBooleanStrict).getOrElse(false)
  systemProperty("java.awt.headless", (!nativeUi).toString())
  systemProperty("muse.nativeUi", nativeUi.toString())
  testLogging { events("passed", "failed", "skipped") }
}
tasks.named<VerifyPluginTask>("verifyPlugin") {
  offline = true
  maxHeapSize = "1024m"
  jvmArgs("-Dplugin.verifier.home.dir=${layout.buildDirectory.dir("verifier-home").get().asFile}")
}

tasks.check { dependsOn("ktlintCheck", "detekt") }
