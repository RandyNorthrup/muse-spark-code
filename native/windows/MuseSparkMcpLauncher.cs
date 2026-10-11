// The Windows MCP stdio launcher's entry and its configuration (M50),
// compiled with MuseSparkMcpJob.cs into one console application on first
// use and kept out of the host bundle (PLAN.md D6). The self-test argument
// and answer and the configuration variable are constants in
// src/shared/constants.ts; test/unit/jobSource.test.ts holds them together.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

[DataContract]
public sealed class MuseSparkMcpLaunchConfig {
  [DataMember(Name = "file", IsRequired = true)] public string File { get; set; }
  [DataMember(Name = "args", IsRequired = true)] public string[] Args { get; set; }
  [DataMember(Name = "cwd", IsRequired = true)] public string Cwd { get; set; }
  [DataMember(Name = "env", IsRequired = true)] public Dictionary<string, string> Env { get; set; }
  [DataMember(Name = "parentPid", IsRequired = true)] public uint ParentPid { get; set; }
  [DataMember(Name = "isVerbatim", IsRequired = true)] public bool IsVerbatim { get; set; }
  [DataMember(Name = "controlPipe", IsRequired = true)] public string ControlPipe { get; set; }
  [DataMember(Name = "controlNonce", IsRequired = true)] public string ControlNonce { get; set; }
  // M91b: a plugin child's whole job memory in bytes; absent (0) sets no limit.
  [DataMember(Name = "jobMemoryLimit", IsRequired = false)] public ulong JobMemoryLimit { get; set; }
  // C1: only the browser's fixed two CDP pipes, never arbitrary inherited descriptors.
  [DataMember(Name = "debugPipes", IsRequired = false)] public bool DebugPipes { get; set; }
  // SPAWN017C: an attested launch keeps the control pipe for STOP and the final record.
  [DataMember(Name = "attestation", IsRequired = false)] public MuseSparkMcpAttestationConfig Attestation { get; set; }
}

[DataContract]
public sealed class MuseSparkMcpAttestationConfig {
  [DataMember(Name = "activeProcessLimit", IsRequired = true)] public uint ActiveProcessLimit { get; set; }
  [DataMember(Name = "spawnLimit", IsRequired = true)] public uint SpawnLimit { get; set; }
  [DataMember(Name = "spawnWindowMs", IsRequired = true)] public int SpawnWindowMs { get; set; }
  [DataMember(Name = "sampleMs", IsRequired = true)] public int SampleMs { get; set; }
  [DataMember(Name = "emptyTimeoutMs", IsRequired = true)] public int EmptyTimeoutMs { get; set; }
}

public static class MuseSparkMcpJobEntry {
  public static int Main(string[] arguments) {
    try {
      if (arguments.Length == 1 && arguments[0] == "--self-test") {
        Console.WriteLine("muse-spark-mcp-job-ready");
        return 0;
      }
      if (arguments.Length != 0) throw new InvalidDataException("invalid MCP launcher arguments");
      string encoded = Environment.GetEnvironmentVariable("MUSE_SPARK_MCP_JOB_CONFIG");
      Environment.SetEnvironmentVariable("MUSE_SPARK_MCP_JOB_CONFIG", null);
      if (encoded == null) throw new InvalidDataException("missing MCP launch config");
      MuseSparkMcpLaunchConfig config;
      using (var stream = new MemoryStream(Convert.FromBase64String(encoded))) {
        var serializer = new DataContractJsonSerializer(typeof(MuseSparkMcpLaunchConfig),
          new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true });
        config = (MuseSparkMcpLaunchConfig)serializer.ReadObject(stream);
      }
      if (config == null || config.File == null || config.Args == null ||
          config.Cwd == null || config.Env == null || config.ControlPipe == null ||
          config.ControlNonce == null) throw new InvalidDataException("invalid MCP launch config");
      var pairs = new List<string>();
      foreach (var entry in config.Env) pairs.Add(entry.Key + "=" + entry.Value);
      if (config.Attestation != null) {
        var attest = config.Attestation;
        if (attest.ActiveProcessLimit == 0 || attest.SpawnLimit == 0 || attest.SpawnWindowMs <= 0 ||
            attest.SampleMs <= 0 || attest.EmptyTimeoutMs <= 0 || config.DebugPipes)
          throw new InvalidDataException("invalid attestation config");
        return MuseSparkMcpJob.RunAttested(config.File, config.Args, config.Cwd,
          config.ParentPid, pairs.ToArray(), config.IsVerbatim, config.ControlPipe,
          config.ControlNonce, config.JobMemoryLimit, new MuseSparkJobAttestation {
            ActiveProcessLimit = attest.ActiveProcessLimit,
            SpawnLimit = attest.SpawnLimit,
            SpawnWindowMs = attest.SpawnWindowMs,
            SampleMs = attest.SampleMs,
            EmptyTimeoutMs = attest.EmptyTimeoutMs,
          });
      }
      return MuseSparkMcpJob.Run(config.File, config.Args, config.Cwd,
        config.ParentPid, pairs.ToArray(), config.IsVerbatim,
        config.ControlPipe, config.ControlNonce, config.JobMemoryLimit, config.DebugPipes);
    } catch (Exception error) {
      Exception cause = error.GetBaseException();
      if (cause is Win32Exception) {
        Console.Error.WriteLine("MCP launcher Win32 error " + ((Win32Exception)cause).NativeErrorCode);
      } else {
        Console.Error.WriteLine("MCP launcher failed: " + cause.GetType().Name);
      }
      return 1;
    }
  }
}
