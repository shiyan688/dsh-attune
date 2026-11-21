using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace AttuneDesktop
{
    internal sealed class PetWindow : Window
    {
        private readonly Image image;
        private readonly TranslateTransform bob = new TranslateTransform();
        private readonly DispatcherTimer blink = new DispatcherTimer();
        private readonly DispatcherTimer settle = new DispatcherTimer();
        private readonly DispatcherTimer pricing = new DispatcherTimer();
        private readonly DispatcherTimer idle = new DispatcherTimer();
        private readonly DispatcherTimer dismiss = new DispatcherTimer();
        private readonly PetOverlay overlay = new PetOverlay();
        private readonly Random random = new Random();
        private readonly Portraits portraits;
        private readonly Action<Drawing.Point> saveLocation;
        private readonly Action activateDesktop;
        private ContextMenu menu;
        private bool enableMotion;
        private bool enableChatter;
        private bool greeted;
        private int lastRemark = -1;
        private bool over;
        private bool pressing;
        private bool dragging;
        private bool doubleClick;
        private bool previousDrag;
        private Drawing.Point pressPoint;
        private Drawing.Point pressWindow;
        private IntPtr handle;

        private static readonly string[] remarks = {
            "我在这儿，有需要就叫我。",
            "有个新点子？可以先聊聊。",
            "哪里聊得不顺，可以划出来做道题。",
            "忙完这段，记得伸个懒腰。",
        };

        internal PetWindow(Portraits portraits, Action<Drawing.Point> saveLocation, Action activateDesktop)
        {
            this.portraits = portraits;
            this.saveLocation = saveLocation;
            this.activateDesktop = activateDesktop;
            Title = "大肥鱼桌宠";
            Width = 184;
            Height = 308;
            ResizeMode = ResizeMode.NoResize;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ShowInTaskbar = false;
            ShowActivated = false;
            Topmost = true;
            Focusable = false;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = SystemParameters.WorkArea.Right - Width - 20;
            Top = SystemParameters.WorkArea.Bottom - Height - 16;

            image = new Image
            {
                Stretch = Stretch.Uniform, Width = 124, Height = 114,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                RenderTransform = bob, Cursor = Cursors.Hand,
                ToolTip = "双击回到 DeepSeek Harness · 右键打开菜单 · 按住拖动",
            };
            RenderOptions.SetBitmapScalingMode(image, BitmapScalingMode.HighQuality);
            AutomationProperties.SetName(image, "大肥鱼");
            var layout = new Grid { Margin = new Thickness(4, 0, 4, 4) };
            layout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(119) });
            layout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(114) });
            layout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetRow(image, 1);
            Grid.SetRow(overlay.Pricing, 2);
            layout.Children.Add(overlay.Bubble);
            layout.Children.Add(image);
            layout.Children.Add(overlay.Pricing);
            Content = layout;
            image.MouseEnter += OnEnter;
            image.MouseLeave += OnLeave;
            image.MouseLeftButtonDown += BeginDrag;
            image.MouseMove += ContinueDrag;
            image.MouseLeftButtonUp += FinishGesture;
            image.LostMouseCapture += (sender, args) => { pressing = false; dragging = false; };

            blink.Interval = TimeSpan.FromSeconds(5);
            blink.Tick += (sender, args) => { if (!over && !pressing) Pose("blink", 150); };
            settle.Tick += (sender, args) => { settle.Stop(); RefreshPose(); };
            pricing.Interval = TimeSpan.FromSeconds(15);
            pricing.Tick += (sender, args) => RefreshPricing();
            idle.Tick += (sender, args) => OnIdle();
            dismiss.Tick += (sender, args) => HideBubble();
            IsVisibleChanged += (sender, args) =>
            {
                SetMotion(enableMotion);
                ScheduleChatter();
                pricing.Stop();
                if (IsVisible)
                {
                    RefreshPricing();
                    pricing.Start();
                }
                else HideBubble();
            };
            RefreshPose();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            handle = new WindowInteropHelper(this).Handle;
            Native.MakeCompanion(handle);
            HwndSource.FromHwnd(handle).AddHook(DisplayChanged);
        }

        private IntPtr DisplayChanged(IntPtr window, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (message == 0x007E || message == 0x001A) // WM_DISPLAYCHANGE or WM_SETTINGCHANGE
                Dispatcher.BeginInvoke(new Action(() => { if (IsVisible && !pressing) Place(null, false); }));
            return IntPtr.Zero;
        }

        internal void SetMenu(ContextMenu menu)
        {
            this.menu = menu;
            image.ContextMenu = menu;
            overlay.Pricing.ContextMenu = menu;
        }

        internal void SetChatter(bool enabled)
        {
            enableChatter = enabled;
            ScheduleChatter();
        }

        private void RefreshPricing()
        {
            overlay.ShowPeriod(Tariff.At(DateTimeOffset.UtcNow));
        }

        private void ScheduleChatter()
        {
            idle.Stop();
            if (!enableChatter || !IsVisible) return;
            idle.Interval = greeted ? TimeSpan.FromMinutes(random.Next(8, 16)) : TimeSpan.FromSeconds(14);
            idle.Start();
        }

        private void OnIdle()
        {
            if (pressing || over || menu.IsOpen || dismiss.IsEnabled)
            {
                idle.Stop();
                idle.Interval = TimeSpan.FromSeconds(35);
                idle.Start();
                return;
            }
            lastRemark = lastRemark < 0 ? random.Next(remarks.Length) : (lastRemark + random.Next(1, remarks.Length)) % remarks.Length;
            ShowBubble("", remarks[lastRemark], 6);
            greeted = true;
            ScheduleChatter();
        }

        internal void ShowBubble(string title, string message, int seconds)
        {
            if (!IsVisible) return;
            overlay.ShowBubble(title, message);
            dismiss.Stop();
            dismiss.Interval = TimeSpan.FromSeconds(seconds);
            dismiss.Start();
        }

        private void HideBubble()
        {
            dismiss.Stop();
            overlay.Bubble.Visibility = Visibility.Hidden;
        }

        internal void SetMotion(bool enabled)
        {
            enableMotion = enabled;
            blink.Stop();
            settle.Stop();
            bob.BeginAnimation(TranslateTransform.YProperty, null);
            if (CanAnimate && IsVisible) blink.Start();
            RefreshPose();
        }

        private bool CanAnimate { get { return enableMotion && SystemParameters.ClientAreaAnimation; } }

        internal void RefreshPose()
        {
            image.Source = portraits.Get(over && CanAnimate ? "curious" : "idle");
        }

        private void OnEnter(object sender, MouseEventArgs e)
        {
            over = true;
            if (!settle.IsEnabled && !pressing) RefreshPose();
        }

        private void OnLeave(object sender, MouseEventArgs e)
        {
            over = false;
            if (!settle.IsEnabled && !pressing) RefreshPose();
        }

        private void Pose(string state, int milliseconds)
        {
            if (!CanAnimate) return;
            image.Source = portraits.Get(state);
            settle.Stop();
            settle.Interval = TimeSpan.FromMilliseconds(milliseconds);
            settle.Start();
        }

        internal void Place(Drawing.Point? location, bool useDefault)
        {
            var bounds = Native.Bounds(handle);
            var desired = location ?? bounds.Location;
            var monitor = useDefault
                ? Forms.Screen.FromPoint(Forms.Cursor.Position)
                : Forms.Screen.FromPoint(new Drawing.Point(desired.X + bounds.Width / 2, desired.Y + bounds.Height / 2));
            var area = monitor.WorkingArea;
            if (useDefault) desired = new Drawing.Point(area.Right - bounds.Width - 20, area.Bottom - bounds.Height - 16);
            MoveInside(desired, bounds.Size, area);
        }

        private void MoveInside(Drawing.Point desired, Drawing.Size size, Drawing.Rectangle area)
        {
            var x = Math.Max(area.Left, Math.Min(desired.X, area.Right - size.Width));
            var y = Math.Max(area.Top, Math.Min(desired.Y, area.Bottom - size.Height));
            Native.Move(handle, x, y);
        }

        private void BeginDrag(object sender, MouseButtonEventArgs e)
        {
            pressing = true;
            dragging = false;
            doubleClick = e.ClickCount == 2 && !previousDrag;
            pressPoint = Forms.Cursor.Position;
            pressWindow = Native.Bounds(handle).Location;
            image.CaptureMouse();
            e.Handled = true;
        }

        private void ContinueDrag(object sender, MouseEventArgs e)
        {
            if (!pressing || e.LeftButton != MouseButtonState.Pressed) return;
            var point = Forms.Cursor.Position;
            int dx = point.X - pressPoint.X, dy = point.Y - pressPoint.Y;
            if (!dragging && Math.Abs(dx) < 5 && Math.Abs(dy) < 5) return;
            dragging = true;
            var bounds = Native.Bounds(handle);
            MoveInside(new Drawing.Point(pressWindow.X + dx, pressWindow.Y + dy),
                bounds.Size, Forms.Screen.FromPoint(point).WorkingArea);
        }

        private void FinishGesture(object sender, MouseButtonEventArgs e)
        {
            if (!pressing) return;
            bool moved = dragging;
            previousDrag = moved;
            pressing = dragging = false;
            image.ReleaseMouseCapture();
            if (moved)
            {
                saveLocation(Native.Bounds(handle).Location);
            }
            else if (image.IsMouseOver)
            {
                if (doubleClick) activateDesktop();
                Pose("happy", 900);
                if (CanAnimate)
                    bob.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(-4, 0, new Duration(TimeSpan.FromMilliseconds(260))));
            }
            e.Handled = true;
        }

        protected override void OnClosed(EventArgs e)
        {
            blink.Stop();
            settle.Stop();
            idle.Stop();
            dismiss.Stop();
            pricing.Stop();
            base.OnClosed(e);
        }
    }

    internal static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct Rect { internal int Left, Top, Right, Bottom; }

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr handle, out Rect rect);
        [DllImport("user32.dll")]
        private static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int w, int h, uint flags);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
        private static extern int GetWindowLong(IntPtr handle, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
        private static extern int SetWindowLong(IntPtr handle, int index, int value);
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr handle, StringBuilder name, int length);
        [DllImport("user32.dll")]
        private static extern int GetWindowTextLength(IntPtr handle);
        private delegate bool EnumWindow(IntPtr handle, IntPtr parameter);
        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr handle);
        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr handle);
        [DllImport("user32.dll")]
        private static extern bool ShowWindowAsync(IntPtr handle, int command);
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr handle);
        [DllImport("user32.dll")]
        private static extern bool FlashWindow(IntPtr handle, bool invert);

        private static bool IsDesktopWindow(IntPtr window, int pid)
        {
            uint owner;
            if (GetWindowThreadProcessId(window, out owner) == 0 || owner != pid || GetWindowTextLength(window) == 0)
                return false;
            var name = new StringBuilder(32);
            GetClassName(window, name, name.Capacity);
            return name.ToString() == "Chrome_WidgetWin_1";
        }

        internal static IntPtr FindDesktopWindow(int pid)
        {
            IntPtr foreground = GetForegroundWindow();
            if (IsDesktopWindow(foreground, pid)) return foreground;
            IntPtr found = IntPtr.Zero;
            EnumWindows((window, unused) =>
            {
                if (!IsDesktopWindow(window, pid)) return true;
                if (found == IntPtr.Zero) found = window;
                if (!IsWindowVisible(window)) return true;
                found = window;
                return false;
            }, IntPtr.Zero);
            return found;
        }

        internal static void ActivateDesktop(ref IntPtr window, int pid)
        {
            if (!IsDesktopWindow(window, pid)) window = FindDesktopWindow(pid);
            if (window == IntPtr.Zero) return;
            if (IsIconic(window)) ShowWindowAsync(window, 9); // SW_RESTORE
            else if (!IsWindowVisible(window)) ShowWindowAsync(window, 5); // SW_SHOW
            if (!SetForegroundWindow(window)) FlashWindow(window, true);
        }

        internal static void MakeCompanion(IntPtr handle)
        {
            const int extendedStyle = -20, toolWindow = 0x80, noActivate = 0x08000000;
            SetWindowLong(handle, extendedStyle, GetWindowLong(handle, extendedStyle) | toolWindow | noActivate);
        }

        internal static Drawing.Rectangle Bounds(IntPtr handle)
        {
            Rect rect;
            GetWindowRect(handle, out rect);
            return Drawing.Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
        }

        internal static void Move(IntPtr handle, int x, int y)
        {
            const uint noSize = 0x0001, noZOrder = 0x0004, noActivate = 0x0010;
            SetWindowPos(handle, IntPtr.Zero, x, y, 0, 0, noSize | noZOrder | noActivate);
        }
    }
}
