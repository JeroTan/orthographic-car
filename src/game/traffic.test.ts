import { describe, expect, it } from 'vitest';

import { createTerrainIndex, generateWorld } from './world';
import {
	createTrafficSimulation,
	DEFAULT_TRAFFIC_VEHICLE_COUNT,
	MAX_TRAFFIC_VEHICLES,
	TRAFFIC_VEHICLE_KINDS,
} from './traffic';

describe('ambient traffic simulation', () => {
	it('spawns capped varied vehicles on road surface', () => {
		const world = generateWorld(6767);
		const terrain = createTerrainIndex(world);
		const traffic = createTrafficSimulation({
			layout: world,
			seed: 6767,
			maxVehicles: DEFAULT_TRAFFIC_VEHICLE_COUNT,
		});

		expect(traffic.vehicles).toHaveLength(DEFAULT_TRAFFIC_VEHICLE_COUNT);
		expect(new Set(traffic.vehicles.map((vehicle) => vehicle.kind))).toEqual(
		new Set(TRAFFIC_VEHICLE_KINDS),
	);
		expect(traffic.vehicles.every((vehicle) => terrain.isRoadAt(vehicle.x, vehicle.z))).toBe(true);
		expect(
			createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: MAX_TRAFFIC_VEHICLES + 10 })
				.vehicles.length,
		).toBe(MAX_TRAFFIC_VEHICLES);
	});

	it('moves deterministically while staying on connected road tiles', () => {
		const world = generateWorld(1337);
		const terrain = createTerrainIndex(world);
		const first = createTrafficSimulation({ layout: world, seed: 1337, maxVehicles: 6 });
		const second = createTrafficSimulation({ layout: world, seed: 1337, maxVehicles: 6 });
		const initial = first.vehicles.map((vehicle) => ({ x: vehicle.x, z: vehicle.z }));

		first.step(1.25);
		second.step(1.25);

		expect(first.vehicles).toEqual(second.vehicles);
		expect(
			first.vehicles.some(
				(vehicle, index) => vehicle.x !== initial[index].x || vehicle.z !== initial[index].z,
			),
		).toBe(true);
		expect(first.vehicles.every((vehicle) => terrain.isRoadAt(vehicle.x, vehicle.z))).toBe(true);
	});

	it('supports disabling ambient traffic', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(1), seed: 1, maxVehicles: 0 });

		expect(traffic.vehicles).toEqual([]);
	});
});
