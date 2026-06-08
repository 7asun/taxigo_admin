/** nuqs URL keys for Fahrerschichtplanung — single source, no duplicated literals. */
export const DRIVER_PLANNING_URL_PARAMS = {
  week: 'week',
  driver: 'driver'
} as const;

/** Sentinel for "Alle Fahrer" in filter Select — not a real UUID. */
export const DRIVER_FILTER_ALL = '__all__' as const;

/** Sentinel for unselected driver in create dialog — not a real UUID. */
export const CREATE_DRIVER_PLACEHOLDER = '__none__' as const;
