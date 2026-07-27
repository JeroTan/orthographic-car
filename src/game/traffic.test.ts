import { describe, expect, it } from 'vitest';

import { createTerrainIndex, generateWorld } from './world';
import {
	createTrafficSimulation,
	DEFAULT_TRAFFIC_VEHICLE_COUNT,
	MAX_TRAFFIC_VEHICLES,
	TRAFFIC_VEHICLE_KINDS,
} from './traffic';

function wrappedDelta(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

describe('ambient traffic simulation', () => {
	it('keeps each traffic vehicle facing its direction of travel', () => {
		const world = generateWorld(6767);
		const traffic = createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: 1 });

		for (let step = 0; step < 9; step += 1) {
			const previous = { ...traffic.vehicles[0] };
			traffic.step(0.05);
			const vehicle = traffic.vehicles[0];
			const deltaX = wrappedDelta(vehicle.x - previous.x, world.worldSpan);
			const deltaZ = wrappedDelta(vehicle.z - previous.z, world.worldSpan);
			const distance = Math.hypot(deltaX, deltaZ);
			const forwardDot =
				(Math.sin(vehicle.heading) * deltaX + Math.cos(vehicle.heading) * deltaZ) / distance;

			expect(forwardDot).toBeGreaterThan(0);
		}
	});

	it('keeps traffic facing its curved road path', () => {
		const world = generateWorld(6767);
		const traffic = createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: 2 });

		for (let step = 0; step < 240; step += 1) {
			const previous = traffic.vehicles.map(({ x, z }) => ({ x, z }));
			traffic.step(0.05);

			for (let index = 0; index < traffic.vehicles.length; index += 1) {
				const vehicle = traffic.vehicles[index];
				const deltaX = wrappedDelta(vehicle.x - previous[index].x, world.worldSpan);
				const deltaZ = wrappedDelta(vehicle.z - previous[index].z, world.worldSpan);
				const distance = Math.hypot(deltaX, deltaZ);
				const forwardDot =
					(Math.sin(vehicle.heading) * deltaX + Math.cos(vehicle.heading) * deltaZ) / distance;

				expect(forwardDot).toBeGreaterThan(0);
			}
		}
	});

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
