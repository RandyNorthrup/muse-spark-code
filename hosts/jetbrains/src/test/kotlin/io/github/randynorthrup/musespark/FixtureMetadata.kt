package io.github.randynorthrup.musespark

import com.google.gson.JsonObject

/** Fixed editor metadata every fixture peer offers: the production shape, deterministic values. */
fun fixtureMetadata(): JsonObject =
  json(
    "host" to json("id" to "jetbrains", "version" to "253"),
    "locale" to "en",
    "theme" to json("kind" to "dark", "tokens" to json()),
    "folders" to emptyList<String>(),
    "trusted" to true,
  )
