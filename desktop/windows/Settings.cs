using System;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;

namespace AttuneDesktop
{
    [DataContract]
    internal sealed class Settings
    {
        [DataMember] internal int? Left;
        [DataMember] internal int? Top;
        [DataMember] internal bool? Motion;
        [DataMember] internal bool? Bubbles;
        [DataMember] internal bool? Visible;

        internal static Settings Load(string path)
        {
            if (!File.Exists(path)) return new Settings();
            try
            {
                using (var file = File.OpenRead(path))
                {
                    if (file.Length <= 16384)
                        return (Settings)new DataContractJsonSerializer(typeof(Settings)).ReadObject(file) ?? new Settings();
                }
            }
            catch (IOException) { }
            catch (SerializationException) { }
            catch (UnauthorizedAccessException) { }
            return new Settings();
        }

        internal void Save(string path)
        {
            Files.Write(path, stream => new DataContractJsonSerializer(typeof(Settings)).WriteObject(stream, this));
        }
    }

    internal static class Files
    {
        internal static void Write(string path, Action<Stream> content)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temporary = path + ".tmp";
            try
            {
                using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    content(file);
                    file.Flush(true);
                }
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally
            {
                File.Delete(temporary);
            }
        }
    }
}
