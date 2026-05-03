export interface PassengerEntry {
  uid: string;
  client_id?: string;
  first_name: string;
  last_name: string;
  phone?: string;
  pickup_group_uid: string;
  pickup_station: string;
  dropoff_group_uid: string | null;
  dropoff_station: string;
  is_wheelchair: boolean;
}

export interface AddressGroupEntry {
  uid: string;
  address: string; // The full formatted address for display/backward compat
  street?: string;
  street_number?: string;
  zip_code?: string;
  city?: string;
  lat?: number;
  lng?: number;
  /** Google Places place_id when the row came from Autocomplete + Place Details; optional for free-text rows. */
  placeId?: string;
}
