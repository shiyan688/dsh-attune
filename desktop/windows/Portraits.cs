using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Windows.Media.Imaging;

namespace AttuneDesktop
{
    internal sealed class Portraits
    {
        private readonly Dictionary<string, BitmapSource> defaults = new Dictionary<string, BitmapSource>();
        private Dictionary<string, BitmapSource> custom = new Dictionary<string, BitmapSource>();

        [DataContract]
        private sealed class Appearance
        {
            [DataMember(Name = "images")] internal Dictionary<string, string> Images { get; set; }
        }

        internal Portraits(string path)
        {
            foreach (string pose in new[] { "idle", "blink", "curious", "happy" })
            {
                using (var stream = Resource(pose + ".png"))
                    defaults.Add(pose, ReadPng(stream));
            }
            Reload(path);
        }

        internal static Stream Resource(string name)
        {
            return Assembly.GetExecutingAssembly().GetManifestResourceStream("Attune." + name);
        }

        private static BitmapSource ReadPng(Stream stream)
        {
            var frame = BitmapFrame.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
            frame.Freeze();
            return frame;
        }

        internal BitmapSource Get(string pose)
        {
            BitmapSource frame;
            if (!custom.TryGetValue("idle", out frame)) return defaults[pose];
            BitmapSource expression;
            string key = pose == "curious" ? "thinking" : pose;
            return custom.TryGetValue(key, out expression) ? expression : frame;
        }

        internal void Reload(string path)
        {
            var next = new Dictionary<string, BitmapSource>();
            try
            {
                using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
                {
                    if (stream.Length > 2306867) return;
                    var serializer = new DataContractJsonSerializer(typeof(Appearance),
                        new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true });
                    var appearance = (Appearance)serializer.ReadObject(stream);
                    if (appearance == null || appearance.Images == null) return;
                    foreach (var pose in new[] { "idle", "thinking", "happy" })
                    {
                        string data;
                        if (!appearance.Images.TryGetValue(pose, out data)) continue;
                        BitmapSource frame = DecodeAppearance(data);
                        if (frame != null) next.Add(pose, frame);
                    }
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (SerializationException) { }
            catch (FormatException) { }
            catch (NotSupportedException) { }
            finally { custom = next; }
        }

        private static BitmapSource DecodeAppearance(string data)
        {
            const string prefix = "data:image/png;base64,";
            if (data == null || !data.StartsWith(prefix, StringComparison.Ordinal) || data.Length > prefix.Length + 699052)
                return null;
            byte[] bytes = Convert.FromBase64String(data.Substring(prefix.Length));
            using (var stream = new MemoryStream(bytes))
            {
                var decoder = new PngBitmapDecoder(stream, BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
                var info = decoder.Frames[0];
                if (info.PixelWidth < 1 || info.PixelHeight < 1 || info.PixelWidth > 768 || info.PixelHeight > 768)
                    return null;
                stream.Position = 0;
                return ReadPng(stream);
            }
        }
    }
}
