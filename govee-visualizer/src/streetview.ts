import { JobFailure } from './queue.js';

/**
 * Turns a typed address into a photo of the house using Google Maps Platform:
 *
 *   1. Geocoding API      address / place id  -> the house's coordinates (rooftop when Google has it)
 *   2. Street View meta   house coordinates   -> nearest outdoor panorama and where its camera stands
 *   3. Street View Static camera + heading    -> 640x480 JPEG looking from the street at the house
 *
 * Step 3 is the trick that makes this work: the heading is the compass bearing from the panorama's camera
 * to the house, so the picture is aimed at the house rather than straight down the road.
 * Metadata requests are free; Geocoding and Static images are billed per request.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult extends LatLng {
  formattedAddress: string;
  placeId: string;
  locationType: string;
}

export interface HouseImage {
  jpeg: Buffer;
  geocode: GeocodeResult;
  panoId: string;
  heading: number;
}

type FetchFn = typeof fetch;

const MAPS = 'https://maps.googleapis.com/maps/api';

/** Initial compass bearing in degrees (0 = north, clockwise) from `from` to `to`. */
export function bearing(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const φ1 = from.lat * rad;
  const φ2 = to.lat * rad;
  const Δλ = (to.lng - from.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

export class StreetView {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  get enabled() {
    return Boolean(this.apiKey);
  }

  async geocode(address: string, placeId?: string): Promise<GeocodeResult> {
    const params = new URLSearchParams({ key: this.apiKey });
    if (placeId) params.set('place_id', placeId);
    else params.set('address', address);
    const body = await this.getJson(`${MAPS}/geocode/json?${params}`);
    if (body.status === 'ZERO_RESULTS') {
      throw new JobFailure('address_not_found', "We couldn't find that address. Check it, or upload a photo of your house instead.");
    }
    if (body.status !== 'OK' || !body.results?.[0]) throw new Error(`Geocoding failed: ${body.status} ${body.error_message ?? ''}`);
    const r = body.results[0];
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: r.formatted_address,
      placeId: r.place_id,
      locationType: r.geometry.location_type,
    };
  }

  async fetchHouseImage(address: string, placeId?: string): Promise<HouseImage> {
    const geocode = await this.geocode(address, placeId);

    const metaParams = new URLSearchParams({
      location: `${geocode.lat},${geocode.lng}`,
      radius: '80',
      source: 'outdoor',
      key: this.apiKey,
    });
    const meta = await this.getJson(`${MAPS}/streetview/metadata?${metaParams}`);
    if (meta.status === 'ZERO_RESULTS' || meta.status === 'NOT_FOUND') {
      throw new JobFailure('no_street_view', "Google doesn't have a street photo of this address. Upload a photo of your house and we'll light it up.");
    }
    if (meta.status !== 'OK') throw new Error(`Street View metadata failed: ${meta.status} ${meta.error_message ?? ''}`);

    const heading = bearing(meta.location, geocode);
    const imgParams = new URLSearchParams({
      size: '640x480',
      pano: meta.pano_id,
      heading: heading.toFixed(1),
      pitch: '8',
      fov: '80',
      source: 'outdoor',
      return_error_code: 'true',
      key: this.apiKey,
    });
    const res = await this.fetchFn(`${MAPS}/streetview?${imgParams}`, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) {
      throw new JobFailure('no_street_view', "Google doesn't have a street photo of this address. Upload a photo of your house and we'll light it up.");
    }
    if (!res.ok) throw new Error(`Street View image failed: HTTP ${res.status}`);
    return { jpeg: Buffer.from(await res.arrayBuffer()), geocode, panoId: meta.pano_id, heading };
  }

  private async getJson(url: string): Promise<any> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Google Maps request failed: HTTP ${res.status}`);
    return res.json();
  }
}
