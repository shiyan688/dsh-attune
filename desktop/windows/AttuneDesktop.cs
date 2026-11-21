using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace AttuneDesktop
{
    internal sealed class DesktopApp : Application
    {
        private readonly string settingsPath;
        private readonly string appearancePath;
        private readonly Settings settings;
        private readonly Portraits portraits;
        private readonly PetWindow pet;
        private readonly Forms.NotifyIcon tray;
        private readonly Drawing.Icon trayIcon;
        private readonly ContextMenu menu = new ContextMenu();
        private readonly Forms.ContextMenuStrip trayMenu = new Forms.ContextMenuStrip();
        private readonly int desktopPid;
        private readonly TextWriter output;
        private IntPtr desktopWindow;
        private bool shown;
        private bool checkingUpdate;
        private bool checkingBalance;
        private Action updateFinished;

        [STAThread]
        private static void Main(string[] args)
        {
            int pid;
            if (args.Length != 3 || !int.TryParse(args[0], out pid) || pid <= 0 || !Path.IsPathRooted(args[1])
                || (args[2] != "show" && args[2] != "restore"))
                return;

            using (var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true })
            {
                var app = new DesktopApp(pid, args[1], output);
                var reader = new Thread(app.ReadCommands) { IsBackground = true };
                if (args[2] == "show" || app.settings.Visible.GetValueOrDefault(true)) app.ShowPet();
                else app.Send("hidden");
                reader.Start();
                app.Run();
            }
        }

        private DesktopApp(int desktopPid, string directory, TextWriter output)
        {
            this.desktopPid = desktopPid;
            this.output = output;
            desktopWindow = Native.FindDesktopWindow(desktopPid);
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            settingsPath = Path.Combine(directory, "desktop-window.json");
            appearancePath = Path.Combine(directory, "appearance.json");
            settings = Settings.Load(settingsPath);
            portraits = new Portraits(appearancePath);
            pet = new PetWindow(portraits, point =>
            {
                settings.Left = point.X;
                settings.Top = point.Y;
                SaveSettings();
            }, ActivateDesktop);
            pet.Closed += (sender, args) => Shutdown();
            pet.SetMenu(menu);
            pet.SetMotion(settings.Motion.GetValueOrDefault(true));
            pet.SetChatter(settings.Bubbles.GetValueOrDefault(true));

            using (var stream = Portraits.Resource("pet.ico"))
            using (var icon = new Drawing.Icon(stream))
                trayIcon = (Drawing.Icon)icon.Clone();
            tray = new Forms.NotifyIcon { Icon = trayIcon, Text = "大肥鱼桌宠", ContextMenuStrip = trayMenu };
            tray.DoubleClick += (sender, args) => ShowPet();
            ConfigureMenus();
            tray.Visible = true;
        }

        private void ConfigureMenus()
        {
            MenuAction("默契答题", () =>
            {
                ActivateDesktop();
                Send("quiz");
            });
            MenuAction("查看余额", () =>
            {
                if (checkingBalance) return;
                checkingBalance = true;
                pet.ShowBubble("DeepSeek 余额", "正在查询…", 10);
                Send("balance");
            });

            var check = new MenuItem();
            var trayCheck = new Forms.ToolStripMenuItem();
            Action refresh = () =>
            {
                check.Header = trayCheck.Text = checkingUpdate ? "正在检查更新…" : "检查更新";
                check.IsEnabled = trayCheck.Enabled = !checkingUpdate;
            };
            Action startCheck = () =>
            {
                if (checkingUpdate) return;
                checkingUpdate = true;
                refresh();
                Send("update");
            };
            check.Click += (sender, args) => startCheck();
            trayCheck.Click += (sender, args) => startCheck();
            menu.Items.Add(check);
            trayMenu.Items.Add(trayCheck);
            refresh();
            updateFinished = refresh;

            MenuSeparator();
            MenuToggle("气泡闲聊", settings.Bubbles.GetValueOrDefault(true), value =>
            {
                settings.Bubbles = value;
                pet.SetChatter(value);
                SaveSettings();
            });
            MenuToggle("轻动画", settings.Motion.GetValueOrDefault(true), value =>
            {
                settings.Motion = value;
                pet.SetMotion(value);
                SaveSettings();
            });
            MenuAction("显示桌宠", ShowPet, false);
            MenuAction("隐藏桌宠", HidePet);
            MenuAction("退出桌宠", () => { RememberVisibility(false); Shutdown(); });
        }

        private void ActivateDesktop()
        {
            Native.ActivateDesktop(ref desktopWindow, desktopPid);
        }

        private void MenuSeparator()
        {
            menu.Items.Add(new Separator());
            trayMenu.Items.Add(new Forms.ToolStripSeparator());
        }

        private void MenuAction(string name, Action action, bool usePetMenu = true)
        {
            if (usePetMenu)
            {
                var item = new MenuItem { Header = name };
                item.Click += (sender, args) => action();
                menu.Items.Add(item);
            }
            trayMenu.Items.Add(name, null, (sender, args) => action());
        }

        private void MenuToggle(string name, bool value, Action<bool> change)
        {
            var item = new MenuItem { Header = name, IsCheckable = true, IsChecked = value };
            var trayItem = new Forms.ToolStripMenuItem(name) { Checked = value };
            Action toggle = () =>
            {
                value = !value;
                item.IsChecked = trayItem.Checked = value;
                change(value);
            };
            item.Click += (sender, args) => toggle();
            trayItem.Click += (sender, args) => toggle();
            menu.Items.Add(item);
            trayMenu.Items.Add(trayItem);
        }

        private void RememberVisibility(bool value)
        {
            if (settings.Visible == value) return;
            settings.Visible = value;
            SaveSettings();
        }

        private void ShowPet()
        {
            if (!pet.IsVisible)
            {
                pet.Show();
                Drawing.Point? position = null;
                if (!shown && settings.Left.HasValue && settings.Top.HasValue)
                    position = new Drawing.Point(settings.Left.Value, settings.Top.Value);
                pet.Place(position, !shown && !position.HasValue);
                shown = true;
            }
            RememberVisibility(true);
            Send("shown");
        }

        private void HidePet()
        {
            pet.Hide();
            RememberVisibility(false);
            Send("hidden");
        }

        private void Send(string message)
        {
            try { output.WriteLine(message); }
            catch (IOException) { Shutdown(); }
        }

        private void ReadCommands()
        {
            try
            {
                using (var input = new StreamReader(Console.OpenStandardInput()))
                {
                    string line;
                    while ((line = input.ReadLine()) != null)
                    {
                        string command = line;
                        if (Dispatcher.HasShutdownStarted) return;
                        Dispatcher.BeginInvoke(new Action(() => HandleCommand(command)));
                    }
                }
            }
            catch (IOException) { }
            if (!Dispatcher.HasShutdownStarted) Dispatcher.BeginInvoke(new Action(Shutdown));
        }

        private void HandleCommand(string command)
        {
            if (command == "show") ShowPet();
            else if (command == "hide") HidePet();
            else if (command == "appearance")
            {
                portraits.Reload(appearancePath);
                pet.RefreshPose();
            }
            else if (command.StartsWith("update\t", StringComparison.Ordinal))
            {
                var parts = command.Split('\t');
                if (parts.Length != 4 || !checkingUpdate) return;
                checkingUpdate = false;
                updateFinished();
                ShowUpdateResult(parts[1], parts[2], parts[3]);
            }
            else if (command.StartsWith("balance\t", StringComparison.Ordinal))
            {
                var parts = command.Split('\t');
                if (parts.Length < 3 || parts.Length > 7 || !checkingBalance) return;
                checkingBalance = false;
                ShowBalanceResult(parts);
            }
        }

        private void ShowBalanceResult(string[] parts)
        {
            string title = parts[2] == "account" ? "DeepSeek 平台余额" : "DeepSeek API 余额";
            string message;
            switch (parts[1])
            {
                case "ready": message = String.Join("\n", parts, 3, parts.Length - 3); break;
                case "empty": message = "当前没有可显示的余额。"; break;
                case "missing": message = "请在 DSH 登录 DeepSeek 账户，或在模型设置中添加官方 API Key。"; break;
                case "invalid": message = "官方 API Key 未通过验证，请检查模型设置。"; break;
                default: message = "暂时无法查询，请稍后再试。"; break;
            }
            if (pet.IsVisible) pet.ShowBubble(title, message, 12);
            else tray.ShowBalloonTip(10000, title, message, Forms.ToolTipIcon.None);
        }

        private static void ShowUpdateResult(string status, string current, string latest)
        {
            string message = "当前插件版本  " + current + "\n";
            if (status == "available")
                message += "最新公开版本  " + latest + "\n\n可以在 DeepSeek Harness 的插件管理里更新 dsh-attune。";
            else if (status == "current")
                message += "已是最新公开版本。";
            else if (status == "ahead")
                message += "最新公开版本  " + latest + "\n\n当前运行的是较新的版本。";
            else
                message += "暂时无法获取最新版本，请稍后再试。";
            System.Windows.MessageBox.Show(message, "大肥鱼桌宠 · 检查更新");
        }

        private void SaveSettings()
        {
            try { settings.Save(settingsPath); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        protected override void OnExit(ExitEventArgs e)
        {
            tray.Visible = false;
            tray.Dispose();
            trayMenu.Dispose();
            trayIcon.Dispose();
            base.OnExit(e);
        }
    }
}
