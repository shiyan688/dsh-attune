using System;

namespace AttuneDesktop
{
    internal enum PricePeriod { Peak, OffPeak, Unconfirmed }

    internal static class Tariff
    {
        // DeepSeek uses Beijing weekdays and excludes mainland public holidays.
        // Published State Council holiday ranges, in month/day order (inclusive).
        private static readonly int[,] holidays2026 = {
            {101, 103}, {215, 223}, {404, 406}, {501, 505}, {619, 621}, {925, 927}, {1001, 1007},
        };
        private static readonly int[,] holidays2027 = {
            {101, 103}, {205, 213}, {403, 405}, {501, 505}, {609, 609}, {915, 915}, {1001, 1007},
        };

        internal static PricePeriod At(DateTimeOffset time)
        {
            var beijing = time.ToOffset(TimeSpan.FromHours(8));
            int minutes = beijing.Hour * 60 + beijing.Minute;
            bool busyHours = (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080);
            if (!busyHours || beijing.DayOfWeek == DayOfWeek.Saturday || beijing.DayOfWeek == DayOfWeek.Sunday)
                return PricePeriod.OffPeak;

            var holidays = beijing.Year == 2026 ? holidays2026 : beijing.Year == 2027 ? holidays2027 : null;
            if (holidays == null) return PricePeriod.Unconfirmed;
            int monthDay = beijing.Month * 100 + beijing.Day;
            for (int i = 0; i < holidays.GetLength(0); i++)
                if (monthDay >= holidays[i, 0] && monthDay <= holidays[i, 1]) return PricePeriod.OffPeak;
            return PricePeriod.Peak;
        }
    }
}
