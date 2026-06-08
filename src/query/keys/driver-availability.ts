export const driverAvailabilityKeys = {
  root: ['driver-availability'] as const,
  day: (driverId: string, dateYmd: string) =>
    [...driverAvailabilityKeys.root, driverId, dateYmd] as const,
  driversDay: (dateYmd: string) => ['drivers-availability', dateYmd] as const
};

export const companyWeekShiftsKeys = {
  week: (weekStartYmd: string) => ['company-week-shifts', weekStartYmd] as const
};
