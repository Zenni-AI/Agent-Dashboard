import { describe, expect, it } from 'vitest';
import { JobFailure } from '../src/queue.js';
import { bearing, distanceMeters, fovForDistance, StreetView } from '../src/streetview.js';

describe('bearing', () => {
  it('points the camera from the street to the house', () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 5); // north
    expect(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 5); // east
    expect(bearing({ lat: 1, lng: 0 }, { lat: 0, lng: 0 })).toBeCloseTo(180, 5); // south
    expect(bearing({ lat: 0, lng: 1 }, { lat: 0, lng: 0 })).toBeCloseTo(270, 5); // west
  });
});

function fakeFetch(routes: Record<string, unknown>, calls: string[] = []) {
  return (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const match = Object.keys(routes).find((k) => url.includes(k));
    if (!match) throw new Error(`unexpected ${url}`);
    const body = routes[match];
    if (Buffer.isBuffer(body)) return new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    if (typeof body === 'number') return new Response('', { status: body });
    return Response.json(body);
  }) as typeof fetch;
}

describe('StreetView.fetchHouseImage', () => {
  const geocode = {
    status: 'OK',
    results: [{ formatted_address: '1 Main St, Town, ST 00000, USA', place_id: 'abc', geometry: { location: { lat: 40.0005, lng: -75 }, location_type: 'ROOFTOP' } }],
  };

  it('aims the camera from the panorama toward the geocoded house', async () => {
    const calls: string[] = [];
    // Panorama is due south of the house, so the camera should face north.
    const sv = new StreetView('KEY', fakeFetch({
      '/geocode/json': geocode,
      '/streetview/metadata': { status: 'OK', pano_id: 'PANO1', location: { lat: 40.0, lng: -75 } },
      '/streetview?': Buffer.from('jpeg-bytes'),
    }, calls));
    const house = await sv.fetchHouseImage('1 Main St', 'abc');
    expect(house.panoId).toBe('PANO1');
    expect(house.heading).toBeCloseTo(0, 3);
    expect(house.jpeg.toString()).toBe('jpeg-bytes');
    expect(calls[0]).toContain('place_id=abc');
    const img = new URL(calls[2]!);
    expect(img.searchParams.get('pano')).toBe('PANO1');
    expect(img.searchParams.get('source')).toBe('outdoor');
    expect(img.searchParams.get('return_error_code')).toBe('true');
  });

  it('asks for a photo when there is no street view coverage', async () => {
    const sv = new StreetView('KEY', fakeFetch({ '/geocode/json': geocode, '/streetview/metadata': { status: 'ZERO_RESULTS' } }));
    await expect(sv.fetchHouseImage('1 Main St')).rejects.toMatchObject({ code: 'no_street_view' });
  });

  it('reports unknown addresses', async () => {
    const sv = new StreetView('KEY', fakeFetch({ '/geocode/json': { status: 'ZERO_RESULTS', results: [] } }));
    const err = await sv.fetchHouseImage('nowhere').catch((e) => e);
    expect(err).toBeInstanceOf(JobFailure);
    expect(err.code).toBe('address_not_found');
  });
});

describe('framing', () => {
  it('zooms in on distant houses and widens for close ones', () => {
    expect(fovForDistance(10)).toBe(100);
    expect(fovForDistance(20)).toBe(70);
    expect(fovForDistance(40)).toBe(45);
  });

  it('measures camera-to-house distance', () => {
    expect(distanceMeters({ lat: 40, lng: -75 }, { lat: 40.0002, lng: -75 })).toBeCloseTo(22.2, 0);
  });
});
