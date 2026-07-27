import { describe, expect, it } from 'vitest';

import {
	TRAFFIC_MODEL_IDS,
	TRAFFIC_VEHICLE_KINDS,
	TRAFFIC_VEHICLE_MODELS,
	trafficModelsForKind,
} from './traffic-vehicle-catalog';

describe('traffic vehicle catalog', () => {
	it('covers every traffic class with supplied-model variety', () => {
		expect(TRAFFIC_VEHICLE_MODELS).toHaveLength(30);
		expect(new Set(TRAFFIC_MODEL_IDS).size).toBe(TRAFFIC_MODEL_IDS.length);
		for (const kind of TRAFFIC_VEHICLE_KINDS) {
			expect(trafficModelsForKind(kind).length).toBeGreaterThan(0);
		}
	});

	it('keeps physical model footprints and reference performance distinct', () => {
		const supercar = TRAFFIC_VEHICLE_MODELS.find((model) => model.id === 'mclaren-gts');
		const motorcycle = TRAFFIC_VEHICLE_MODELS.find((model) => model.id === 'motorcycle');
		const bus = TRAFFIC_VEHICLE_MODELS.find((model) => model.id === 'city-bus-1');
		const civic = TRAFFIC_VEHICLE_MODELS.find((model) => model.id === 'honda-civic');
		if (!supercar || !motorcycle || !bus || !civic) throw new Error('Required catalog models missing.');

		expect(supercar.topSpeedKph).toBeGreaterThan(civic.topSpeedKph);
		expect(supercar.zeroTo100Seconds).toBeLessThan(civic.zeroTo100Seconds);
		expect(bus.lengthMeters).toBeGreaterThan(civic.lengthMeters * 2);
		expect(bus.massTons).toBeGreaterThan(civic.massTons * 10);
		expect(motorcycle.widthMeters).toBeLessThan(civic.widthMeters);
	});
});
