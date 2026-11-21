using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace AttuneDesktop
{
    internal sealed class PetOverlay
    {
        internal readonly Border Bubble;
        internal readonly Border Pricing;
        private readonly TextBlock bubbleTitle;
        private readonly TextBlock bubbleBody;
        private readonly TextBlock rateTitle;
        private readonly Border peak;
        private readonly Border offPeak;
        private PricePeriod? lastPeriod;

        internal PetOverlay()
        {
            bubbleTitle = Text("", 11, "#425589", true);
            bubbleBody = Text("", 12.5, "#1C2742");
            bubbleBody.TextWrapping = TextWrapping.Wrap;
            Bubble = Card(new StackPanel { Children = { bubbleTitle, bubbleBody } });
            Bubble.VerticalAlignment = VerticalAlignment.Bottom;
            Bubble.IsHitTestVisible = false;
            Bubble.Visibility = Visibility.Hidden;

            rateTitle = Text("DeepSeek API · Flash", 11, "#39445C", true);
            var rates = new Grid { Margin = new Thickness(0, 4, 0, 3) };
            rates.ColumnDefinitions.Add(new ColumnDefinition());
            rates.ColumnDefinitions.Add(new ColumnDefinition());
            peak = Rate("峰时 ¥8");
            offPeak = Rate("谷时 ¥4");
            peak.Margin = new Thickness(0, 0, 2, 0);
            offPeak.Margin = new Thickness(2, 0, 0, 0);
            Grid.SetColumn(offPeak, 1);
            rates.Children.Add(peak);
            rates.Children.Add(offPeak);
            Pricing = Card(new StackPanel { Children = {
                rateTitle, rates, Text("每百万输出 tokens", 10, "#4A5875"),
            } });
            Pricing.ToolTip = "北京时间工作日 09:00–12:00、14:00–18:00 为峰时。\n" +
                "周末和中国法定节假日为谷时。实际费用以 DeepSeek 官方账单为准。";
        }

        internal void ShowBubble(string title, string message)
        {
            bubbleTitle.Text = title;
            bubbleTitle.Visibility = title.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
            bubbleBody.Text = message;
            Bubble.Visibility = Visibility.Visible;
        }

        internal void ShowPeriod(PricePeriod period)
        {
            if (lastPeriod == period) return;
            lastPeriod = period;
            rateTitle.Text = period == PricePeriod.Unconfirmed ? "Flash · 时段待核对" : "DeepSeek API · Flash";
            RateColors(peak, period == PricePeriod.Peak, "#9E460C");
            RateColors(offPeak, period == PricePeriod.OffPeak, "#076450");
        }

        private static TextBlock Text(string value, double size, string color, bool bold = false)
        {
            return new TextBlock {
                Text = value, FontSize = size, Foreground = Brush(color),
                FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal,
            };
        }

        private static Border Card(UIElement element)
        {
            return new Border {
                Child = element, CornerRadius = new CornerRadius(12), BorderThickness = new Thickness(1),
                BorderBrush = Brush("#B8C6DE"), Background = Brush("#F9FBFF"), Padding = new Thickness(9, 6, 9, 6),
            };
        }

        private static Border Rate(string value)
        {
            var text = Text(value, 13, "#53617E", true);
            text.TextAlignment = TextAlignment.Center;
            return new Border { Child = text, CornerRadius = new CornerRadius(6), Padding = new Thickness(1, 2, 1, 2) };
        }

        private static void RateColors(Border rate, bool active, string accent)
        {
            rate.Background = Brush(active ? accent : "#E8EDF7");
            ((TextBlock)rate.Child).Foreground = Brush(active ? "#FFFFFF" : "#465671");
        }

        private static Brush Brush(string hex)
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            brush.Freeze();
            return brush;
        }
    }
}
