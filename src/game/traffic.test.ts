import { describe, expect, it } from 'vitest';

import { createTerrainIndex, generateWorld, type RoadLayout } from './world';
import {
	createTrafficSimulation,
	DEFAULT_TRAFFIC_VEHICLE_COUNT,
	MAX_TRAFFIC_VEHICLES,
	TRAFFIC_VEHICLE_KINDS,
	type TrafficSimulationOptions,
} from './traffic';

function wrappedDelta(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function angleDelta(first: number, second: number): number {
	return Math.atan2(Math.sin(second - first), Math.cos(second - first));
}

function closestTrafficDistance(
	vehicles: readonly { x: number; z: number }[],
	worldSpan: number,
): number {
	let closest = Number.POSITIVE_INFINITY;
	for (let first = 0; first < vehicles.length; first += 1) {
		for (let second = first + 1; second < vehicles.length; second += 1) {
			closest = Math.min(
				closest,
				Math.hypot(
					wrappedDelta(vehicles[second].x - vehicles[first].x, worldSpan),
					wrappedDelta(vehicles[second].z - vehicles[first].z, worldSpan),
				),
			);
		}
	}
	return closest;
}

function trafficBodyOverlapsTile(
	vehicle: {
		x: number;
		z: number;
		heading: number;
		collisionRadius: number;
		collisionHalfLength: number;
	},
	centerX: number,
	centerZ: number,
	tileSize: number,
	worldSpan: number,
): boolean {
	const collisionOffset = Math.max(0, vehicle.collisionHalfLength - vehicle.collisionRadius);
	const offsets = collisionOffset > 0.08 ? [-collisionOffset, 0, collisionOffset] : [0];
	const halfSize = tileSize / 2;
	for (const offset of offsets) {
		const capsuleX = vehicle.x + Math.sin(vehicle.heading) * offset;
		const capsuleZ = vehicle.z + Math.cos(vehicle.heading) * offset;
		const outsideX = Math.max(
			0,
			Math.abs(wrappedDelta(capsuleX - centerX, worldSpan)) - halfSize,
		);
		const outsideZ = Math.max(
			0,
			Math.abs(wrappedDelta(capsuleZ - centerZ, worldSpan)) - halfSize,
		);
		if (
			outsideX * outsideX + outsideZ * outsideZ <=
			vehicle.collisionRadius * vehicle.collisionRadius
		) {
			return true;
		}
	}
	return false;
}

function trafficBodiesOverlap(
	first: {
		x: number;
		z: number;
		heading: number;
		collisionRadius: number;
		collisionHalfLength: number;
	},
	second: {
		x: number;
		z: number;
		heading: number;
		collisionRadius: number;
		collisionHalfLength: number;
	},
	worldSpan: number,
): boolean {
	const firstCollisionOffset = Math.max(0, first.collisionHalfLength - first.collisionRadius);
	const secondCollisionOffset = Math.max(0, second.collisionHalfLength - second.collisionRadius);
	const firstOffsets =
		firstCollisionOffset > 0.08 ? [-firstCollisionOffset, 0, firstCollisionOffset] : [0];
	const secondOffsets =
		secondCollisionOffset > 0.08 ? [-secondCollisionOffset, 0, secondCollisionOffset] : [0];
	for (const firstOffset of firstOffsets) {
		const firstX = first.x + Math.sin(first.heading) * firstOffset;
		const firstZ = first.z + Math.cos(first.heading) * firstOffset;
		for (const secondOffset of secondOffsets) {
			const secondX = second.x + Math.sin(second.heading) * secondOffset;
			const secondZ = second.z + Math.cos(second.heading) * secondOffset;
			const distance = Math.hypot(
				wrappedDelta(secondX - firstX, worldSpan),
				wrappedDelta(secondZ - firstZ, worldSpan),
			);
			if (distance < first.collisionRadius + second.collisionRadius - 0.05) {
				return true;
			}
		}
	}
	return false;
}

describe('ambient traffic simulation', () => {
	it('does not leave a dense collision chain merged after contact resolution', () => {
		const denseLayout: RoadLayout = {
			gridSize: 16,
			tileSize: 0.5,
			worldSpan: 8,
			roads: Array.from({ length: 256 }, (_, id) => ({ x: id % 16, z: Math.floor(id / 16) })),
		};
		const traffic = createTrafficSimulation({ layout: denseLayout, seed: 66767, maxVehicles: 3 });
		let closest = Number.POSITIVE_INFINITY;

		for (let frame = 0; frame < 1; frame += 1) {
			traffic.step(0.05);
			closest = Math.min(
				closest,
				closestTrafficDistance(traffic.vehicles, denseLayout.worldSpan),
			);
		}

		expect(closest).toBeGreaterThan(1.2);
	});

	it('accelerates traffic from spawn speed toward its cruise speed', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const initialSpeed = traffic.vehicles[0].speed;

		for (let frame = 0; frame < 10; frame += 1) traffic.step(0.05);

		expect(traffic.vehicles[0].speed).toBeGreaterThan(initialSpeed);
		expect(traffic.vehicles[0].longitudinalLoad).toBeGreaterThan(0);
	});

	it('brakes and waits in its lane before reaching a blocked lane', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);
		const initialSpeed = vehicle.speed;

		traffic.step(0.15, {
			x: vehicle.x + forwardX * 4,
			z: vehicle.z + forwardZ * 4,
			velocityX: 0,
			velocityZ: 0,
			radius: 1.2,
			mass: 1.55,
		});

		expect(vehicle.speed).toBeLessThan(initialSpeed);
		expect(vehicle.longitudinalLoad).toBeLessThan(0);
		expect(Math.abs(vehicle.avoidanceOffset)).toBeLessThan(0.01);
	});

	it('decelerates behind full vehicle bodies before rear-end contact', () => {
		const layout: RoadLayout = {
			gridSize: 64,
			tileSize: 6,
			worldSpan: 384,
			roads: Array.from({ length: 64 }, (_, x) => ({ x, z: 32 })),
		};
		// Distributed spawning intentionally keeps a tiny population far apart.
		// Fill corridor enough to exercise body-aware following behavior.
		const traffic = createTrafficSimulation({ layout, seed: 77, maxVehicles: 8 });
		let maximumImpact = 0;
		let maximumBrake = 0;

		for (let frame = 0; frame < 240; frame += 1) {
			traffic.step(0.05);
			const frameImpact = Math.max(
				...traffic.vehicles.map((vehicle) => vehicle.impactIntensity),
			);
			maximumImpact = Math.max(maximumImpact, frameImpact);
			maximumBrake = Math.max(
				maximumBrake,
				...traffic.vehicles.map((vehicle) => vehicle.avoidanceBrake),
			);
		}

		expect(maximumBrake).toBeGreaterThan(0.5);
		expect(maximumImpact).toBeLessThan(0.05);
	}, 15_000);

	it('keeps traffic out of solid map scenery', () => {
		const obstacle = { x: 0, z: 0, radius: 1 };
		const collision = {
			intersectsCircle(x: number, z: number, radius: number) {
				return Math.hypot(x - obstacle.x, z - obstacle.z) < radius + obstacle.radius;
			},
			normalAt(x: number, z: number) {
				const distance = Math.hypot(x - obstacle.x, z - obstacle.z);
				return distance > 0
					? { x: (x - obstacle.x) / distance, z: (z - obstacle.z) / distance }
					: { x: 0, z: -1 };
			},
		};
		const options: TrafficSimulationOptions = {
			layout: generateWorld(6767),
			seed: 6767,
			maxVehicles: 1,
			collision,
		};
		const traffic = createTrafficSimulation(options);
		const vehicle = traffic.vehicles[0];
		obstacle.x = vehicle.x + Math.sin(vehicle.heading) * 3;
		obstacle.z = vehicle.z + Math.cos(vehicle.heading) * 3;
		let closestDistance = Number.POSITIVE_INFINITY;

		for (let frame = 0; frame < 30; frame += 1) {
			traffic.step(0.05);
			closestDistance = Math.min(
				closestDistance,
				Math.hypot(vehicle.x - obstacle.x, vehicle.z - obstacle.z),
			);
		}

		expect(closestDistance).toBeGreaterThan(1.3);
	});

	it('waits behind a persistent blocker without reversing its route', () => {
		const world: RoadLayout = {
			gridSize: 16,
			tileSize: 6,
			worldSpan: 96,
			roads: Array.from({ length: 16 }, (_, x) => ({ x, z: 8 })),
		};
		const traffic = createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);
		const startingHeading = vehicle.heading;
		const blocker = {
			x: vehicle.x + forwardX * 3,
			z: vehicle.z + forwardZ * 3,
			velocityX: 0,
			velocityZ: 0,
			radius: 1.4,
			mass: 2,
		};

		for (let frame = 0; frame < 120; frame += 1) {
			traffic.step(0.05, blocker);
		}

		expect(vehicle.speed).toBeLessThan(0.35);
		expect(Math.cos(vehicle.heading - startingHeading)).toBeGreaterThan(0.9);
	});

	it('returns player recoil and launches traffic after a collision', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);
		const before = { x: vehicle.x, z: vehicle.z };
		const impacts = traffic.resolvePlayerImpacts({
			x: vehicle.x - forwardX * 0.5,
			z: vehicle.z - forwardZ * 0.5,
			velocityX: forwardX * 20,
			velocityZ: forwardZ * 20,
			radius: 1.2,
			mass: 1.55,
		});

		expect(impacts).toHaveLength(1);
		expect(impacts[0].velocityX * forwardX + impacts[0].velocityZ * forwardZ).toBeLessThan(0);
		expect((vehicle.x - before.x) * forwardX + (vehicle.z - before.z) * forwardZ).toBeGreaterThan(0);
		expect(vehicle.verticalVelocity).toBeGreaterThan(0);
		expect(vehicle.impactIntensity).toBeGreaterThan(0);
		expect(vehicle.damage).toBeGreaterThan(0);
		const speedBeforeRecovery = vehicle.speed;

		traffic.step(0.05);

		expect(vehicle.verticalOffset).toBeGreaterThan(0);
		expect(vehicle.speed).toBeLessThan(speedBeforeRecovery);
		expect(vehicle.longitudinalLoad).toBeLessThan(0);

		for (let frame = 0; frame < 120; frame += 1) traffic.step(0.05);

		expect(vehicle.verticalOffset).toBe(0);
		expect(vehicle.verticalVelocity).toBe(0);
		expect(vehicle.speed).toBeGreaterThan(0);
	});

	it('keeps low-speed overlaps grounded', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];

		traffic.resolvePlayerImpacts({
			x: vehicle.x,
			z: vehicle.z,
			velocityX: vehicle.velocityX,
			velocityZ: vehicle.velocityZ,
			radius: 1.2,
			mass: 1.55,
		});

		expect(vehicle.verticalVelocity).toBe(0);
		expect(vehicle.damage).toBe(0);
	});

	it('carries backward recoil after a head-on impact', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);

		traffic.resolvePlayerImpacts({
			x: vehicle.x + forwardX * 0.5,
			z: vehicle.z + forwardZ * 0.5,
			velocityX: -forwardX * 20,
			velocityZ: -forwardZ * 20,
			radius: 1.2,
			mass: 1.55,
		});

		expect(vehicle.velocityX * forwardX + vehicle.velocityZ * forwardZ).toBeLessThan(0);
	});

	it('throws damaged traffic into air after a strong player impact', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 1 });
		const vehicle = traffic.vehicles[0];
		const forwardX = Math.sin(vehicle.heading);
		const forwardZ = Math.cos(vehicle.heading);
		const impacts = traffic.resolvePlayerImpacts({
			x: vehicle.x - forwardX * 0.5,
			z: vehicle.z - forwardZ * 0.5,
			velocityX: forwardX * 70,
			velocityZ: forwardZ * 70,
			radius: 1.2,
			mass: 1.55,
		});

		expect(impacts).toHaveLength(1);
		expect(impacts[0].damage).toBeGreaterThan(0.25);
		expect(vehicle.verticalVelocity).toBeGreaterThan(7);
		expect(vehicle.damage).toBeGreaterThan(0.25);
		expect(vehicle.damage).toBeCloseTo(impacts[0].damage, 8);
		expect(Math.abs(vehicle.crashPitchVelocity)).toBeGreaterThan(0);

		traffic.step(0.1);

		expect(vehicle.verticalOffset).toBeGreaterThan(0.5);
		expect(Math.abs(vehicle.crashPitch)).toBeGreaterThan(0);
	});

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

	it('exposes front-wheel steering while taking a road turn', () => {
		const cornerLayout: RoadLayout = {
			gridSize: 8,
			tileSize: 4,
			worldSpan: 32,
			roads: [
				{ x: 2, z: 2 }, { x: 3, z: 2 }, { x: 4, z: 2 },
				{ x: 4, z: 3 }, { x: 4, z: 4 }, { x: 3, z: 4 }, { x: 2, z: 4 },
			],
		};
		const traffic = createTrafficSimulation({ layout: cornerLayout, seed: 6767, maxVehicles: 1 });
		let maximumSteering = 0;
		let largestHeadingStep = 0;
		let previousHeading = traffic.vehicles[0].heading;

		for (let step = 0; step < 240; step += 1) {
			traffic.step(0.05);
			maximumSteering = Math.max(maximumSteering, Math.abs(traffic.vehicles[0].steeringAngle));
			largestHeadingStep = Math.max(
				largestHeadingStep,
				Math.abs(angleDelta(previousHeading, traffic.vehicles[0].heading)),
			);
			previousHeading = traffic.vehicles[0].heading;
		}

		expect(maximumSteering).toBeGreaterThan(0.1);
		expect(largestHeadingStep).toBeLessThan(0.35);
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
		expect(new Set(traffic.vehicles.map((vehicle) => vehicle.modelId)).size).toBe(
		traffic.vehicles.length,
	);
		expect(traffic.vehicles.every((vehicle) => terrain.isRoadAt(vehicle.x, vehicle.z))).toBe(true);
		expect(
			createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: MAX_TRAFFIC_VEHICLES + 10 })
				.vehicles.length,
		).toBe(MAX_TRAFFIC_VEHICLES);
	});

	it('spreads initial traffic through map regions instead of clustering near player', () => {
		const world = generateWorld(6767);
		const traffic = createTrafficSimulation({
			layout: world,
			seed: 6767,
			maxVehicles: DEFAULT_TRAFFIC_VEHICLE_COUNT,
		});
		const regionKeys = new Set(
			traffic.vehicles.map((vehicle) => {
				const normalizedX =
					(((vehicle.x + world.worldSpan / 2) % world.worldSpan) + world.worldSpan) %
					world.worldSpan;
				const normalizedZ =
					(((vehicle.z + world.worldSpan / 2) % world.worldSpan) + world.worldSpan) %
					world.worldSpan;
				const regionX = Math.min(3, Math.floor((normalizedX / world.worldSpan) * 4));
				const regionZ = Math.min(3, Math.floor((normalizedZ / world.worldSpan) * 4));
				return regionX + regionZ * 4;
			}),
		);

		expect(regionKeys.size).toBeGreaterThanOrEqual(8);
	});

	it('keeps traffic in right-hand lanes for every heading', () => {
		const traffic = createTrafficSimulation({ layout: generateWorld(6767), seed: 6767, maxVehicles: 20 });

		expect(traffic.vehicles.every((vehicle) => vehicle.laneOffset > 0)).toBe(true);
		expect(
			traffic.vehicles.every(
				(vehicle) => vehicle.laneOffset - vehicle.collisionRadius >= 0.04,
			),
		).toBe(true);
	});

	it('keeps vehicle fronts stable instead of flipping from contact recoil', () => {
		const traffic = createTrafficSimulation({
			layout: generateWorld(6767),
			seed: 6767,
			maxVehicles: MAX_TRAFFIC_VEHICLES,
		});
		const previousHeadings = traffic.vehicles.map((vehicle) => vehicle.heading);
		let largestHeadingStep = 0;

		for (let frame = 0; frame < 360; frame += 1) {
			traffic.step(0.05);
			for (const vehicle of traffic.vehicles) {
				largestHeadingStep = Math.max(
					largestHeadingStep,
					Math.abs(angleDelta(previousHeadings[vehicle.id], vehicle.heading)),
				);
				previousHeadings[vehicle.id] = vehicle.heading;
			}
		}

		// A vehicle may make a legitimate 90-degree intersection turn, but
		// contact recoil must never reverse its visual front by 180 degrees.
		expect(largestHeadingStep).toBeLessThan(2.4);
	}, 15_000);

	it('keeps a visible predicted-braking gap between same-lane vehicles', () => {
		const world = generateWorld(6767);
		const traffic = createTrafficSimulation({
			layout: world,
			seed: 6767,
			maxVehicles: MAX_TRAFFIC_VEHICLES,
		});
		let minimumBumperGap = Number.POSITIVE_INFINITY;

		for (let frame = 0; frame < 360; frame += 1) {
			traffic.step(0.05);
			for (let first = 0; first < traffic.vehicles.length; first += 1) {
				for (let second = first + 1; second < traffic.vehicles.length; second += 1) {
					const firstVehicle = traffic.vehicles[first];
					const secondVehicle = traffic.vehicles[second];
					if (Math.abs(angleDelta(firstVehicle.heading, secondVehicle.heading)) > 0.16) {
						continue;
					}
					const deltaX = wrappedDelta(secondVehicle.x - firstVehicle.x, world.worldSpan);
					const deltaZ = wrappedDelta(secondVehicle.z - firstVehicle.z, world.worldSpan);
					const lateralDistance = Math.abs(
						deltaX * Math.cos(firstVehicle.heading) -
							deltaZ * Math.sin(firstVehicle.heading),
					);
					if (lateralDistance > 0.4) continue;
					const longitudinalDistance = Math.abs(
						deltaX * Math.sin(firstVehicle.heading) +
							deltaZ * Math.cos(firstVehicle.heading),
					);
					const bumperGap =
						longitudinalDistance -
							firstVehicle.collisionHalfLength -
							secondVehicle.collisionHalfLength;
					minimumBumperGap = Math.min(minimumBumperGap, bumperGap);
				}
			}
		}

		expect(Number.isFinite(minimumBumperGap)).toBe(true);
		expect(minimumBumperGap).toBeGreaterThanOrEqual(0.75);
	}, 15_000);

	it('yields approaching traffic when player occupies an intersection', () => {
		const layout: RoadLayout = {
			gridSize: 16,
			tileSize: 6,
			worldSpan: 96,
			roads: [
				...Array.from({ length: 16 }, (_, index) => ({ x: index, z: 8 })),
				...Array.from({ length: 16 }, (_, index) => ({ x: 8, z: index })),
			],
		};
		const traffic = createTrafficSimulation({ layout, seed: 6767, maxVehicles: 12 });
		const player = {
			x: (8.5 * layout.tileSize) - layout.worldSpan / 2,
			z: (8.5 * layout.tileSize) - layout.worldSpan / 2,
			velocityX: 0,
			velocityZ: 0,
			radius: 1.2,
			mass: 1.55,
		};
		let strongestYield = 0;

		for (let frame = 0; frame < 240; frame += 1) {
			traffic.step(0.05, player);
			strongestYield = Math.max(
				strongestYield,
				...traffic.vehicles.map((vehicle) => vehicle.avoidanceBrake),
			);
		}

		expect(strongestYield).toBeGreaterThan(0.5);
	});

	it('clears an intersection instead of leaving multiple vehicles stopped inside it', () => {
		const layout: RoadLayout = {
			gridSize: 32,
			tileSize: 6,
			worldSpan: 192,
			roads: [
				...Array.from({ length: 32 }, (_, index) => ({ x: index, z: 16 })),
				...Array.from({ length: 32 }, (_, index) => ({ x: 16, z: index })),
			],
		};
		const traffic = createTrafficSimulation({ layout, seed: 6767, maxVehicles: 20 });
		const intersectionX = (16.5 * layout.tileSize) - layout.worldSpan / 2;
		const intersectionZ = (16.5 * layout.tileSize) - layout.worldSpan / 2;
		let consecutiveClogFrames = 0;
		let longestClogFrames = 0;
		let consecutiveGridlockFrames = 0;
		let longestGridlockFrames = 0;

		for (let frame = 0; frame < 1_200; frame += 1) {
			traffic.step(0.05);
			const stoppedInside = traffic.vehicles.filter(
				(vehicle) =>
					Math.abs(wrappedDelta(vehicle.x - intersectionX, layout.worldSpan)) <
						layout.tileSize * 0.72 &&
					Math.abs(wrappedDelta(vehicle.z - intersectionZ, layout.worldSpan)) <
						layout.tileSize * 0.72 &&
					vehicle.speed < 0.6,
			);
			consecutiveClogFrames = stoppedInside.length >= 2 ? consecutiveClogFrames + 1 : 0;
			longestClogFrames = Math.max(longestClogFrames, consecutiveClogFrames);
			const movingVehicles = traffic.vehicles.filter((vehicle) => vehicle.speed >= 0.1).length;
			consecutiveGridlockFrames =
				frame >= 200 && movingVehicles === 0 ? consecutiveGridlockFrames + 1 : 0;
			longestGridlockFrames = Math.max(longestGridlockFrames, consecutiveGridlockFrames);
		}

		expect(longestClogFrames).toBeLessThan(40);
		expect(longestGridlockFrames).toBeLessThan(40);
	}, 15_000);

	it('does not leave stopped traffic piled inside generated-world intersections', () => {
		const world = generateWorld(6767);
		const roadIds = new Set(world.roads.map(({ x, z }) => z * world.gridSize + x));
		const intersections = world.roads.filter(({ x, z }) => {
			const neighbors = [
				{ x: (x + 1) % world.gridSize, z },
				{ x: (x - 1 + world.gridSize) % world.gridSize, z },
				{ x, z: (z + 1) % world.gridSize },
				{ x, z: (z - 1 + world.gridSize) % world.gridSize },
			];
			return neighbors.filter((neighbor) => roadIds.has(neighbor.z * world.gridSize + neighbor.x))
				.length >= 3;
		});
		const traffic = createTrafficSimulation({
			layout: world,
			seed: 6767,
			maxVehicles: MAX_TRAFFIC_VEHICLES,
		});
		const clogFrames = new Map<number, number>();
		let longestClogFrames = 0;

		for (let frame = 0; frame < 150; frame += 1) {
			traffic.step(0.05);
			for (const intersection of intersections) {
				const id = intersection.z * world.gridSize + intersection.x;
				const centerX =
					(intersection.x + 0.5) * world.tileSize - world.worldSpan / 2;
				const centerZ =
					(intersection.z + 0.5) * world.tileSize - world.worldSpan / 2;
				const stoppedInside = traffic.vehicles.filter(
					(vehicle) =>
						trafficBodyOverlapsTile(
							vehicle,
							centerX,
							centerZ,
							world.tileSize,
							world.worldSpan,
						) &&
						vehicle.speed < 0.6,
				);
				const streak = stoppedInside.length >= 2 ? (clogFrames.get(id) ?? 0) + 1 : 0;
				clogFrames.set(id, streak);
				if (streak > longestClogFrames) {
					longestClogFrames = streak;
				}
			}
		}

		expect(longestClogFrames).toBeLessThan(10);
	}, 15_000);

	it('does not leave traffic bodies stacked at generated-world intersections', () => {
		const world = generateWorld(6767);
		const roadIds = new Set(world.roads.map(({ x, z }) => z * world.gridSize + x));
		const intersections = world.roads
			.filter(({ x, z }) => {
				const neighbors = [
					{ x: (x + 1) % world.gridSize, z },
					{ x: (x - 1 + world.gridSize) % world.gridSize, z },
					{ x, z: (z + 1) % world.gridSize },
					{ x, z: (z - 1 + world.gridSize) % world.gridSize },
				];
				return neighbors.filter((neighbor) =>
					roadIds.has(neighbor.z * world.gridSize + neighbor.x),
				).length >= 3;
			})
			.map(({ x, z }) => ({
				x: (x + 0.5) * world.tileSize - world.worldSpan / 2,
				z: (z + 0.5) * world.tileSize - world.worldSpan / 2,
			}));
		const traffic = createTrafficSimulation({
			layout: world,
			seed: 6767,
			maxVehicles: MAX_TRAFFIC_VEHICLES,
		});
		const overlapFrames = new Map<string, number>();
		let longestOverlapFrames = 0;

		for (let frame = 0; frame < 600; frame += 1) {
			traffic.step(0.05);
			const overlappingPairs = new Set<string>();
			for (let first = 0; first < traffic.vehicles.length; first += 1) {
				for (let second = first + 1; second < traffic.vehicles.length; second += 1) {
					if (
						!trafficBodiesOverlap(
							traffic.vehicles[first],
							traffic.vehicles[second],
							world.worldSpan,
						)
					) {
						continue;
					}
					const overlapsIntersection = intersections.some(
						(intersection) =>
							trafficBodyOverlapsTile(
								traffic.vehicles[first],
								intersection.x,
								intersection.z,
								world.tileSize,
								world.worldSpan,
							) ||
							trafficBodyOverlapsTile(
								traffic.vehicles[second],
								intersection.x,
								intersection.z,
								world.tileSize,
								world.worldSpan,
							),
					);
					if (!overlapsIntersection) continue;
					const key = `${traffic.vehicles[first].id}:${traffic.vehicles[second].id}`;
					overlappingPairs.add(key);
					const streak = (overlapFrames.get(key) ?? 0) + 1;
					overlapFrames.set(key, streak);
					longestOverlapFrames = Math.max(longestOverlapFrames, streak);
				}
			}
			for (const key of overlapFrames.keys()) {
				if (!overlappingPairs.has(key)) overlapFrames.set(key, 0);
			}
		}

		expect(longestOverlapFrames).toBeLessThan(10);
	}, 15_000);

	it('avoids traffic-body pileups when the player blocks a generated intersection', () => {
		const world = generateWorld(6767);
		const roadIds = new Set(world.roads.map(({ x, z }) => z * world.gridSize + x));
		const intersection = world.roads
			.filter(({ x, z }) => {
				const neighbors = [
					{ x: (x + 1) % world.gridSize, z },
					{ x: (x - 1 + world.gridSize) % world.gridSize, z },
					{ x, z: (z + 1) % world.gridSize },
					{ x, z: (z - 1 + world.gridSize) % world.gridSize },
				];
				return neighbors.filter((neighbor) =>
					roadIds.has(neighbor.z * world.gridSize + neighbor.x),
				).length >= 3;
			})
			.map((road) => ({
				...road,
				centerX: (road.x + 0.5) * world.tileSize - world.worldSpan / 2,
				centerZ: (road.z + 0.5) * world.tileSize - world.worldSpan / 2,
			}))
			.sort(
				(first, second) =>
					Math.hypot(first.centerX, first.centerZ) -
					Math.hypot(second.centerX, second.centerZ),
			)[0];
		const traffic = createTrafficSimulation({
			layout: world,
			seed: 6767,
			maxVehicles: 32,
		});

		for (let frame = 0; frame < 60; frame += 1) {
			traffic.step(0.05);
		}

		const player = {
			x: intersection.centerX,
			z: intersection.centerZ,
			velocityX: 0,
			velocityZ: 0,
			radius: 1.2,
			mass: 1.55,
		};
		const overlapFrames = new Map<string, number>();
		let longestOverlapFrames = 0;

		for (let frame = 0; frame < 240; frame += 1) {
			traffic.step(0.05, player);
			const vehiclesInside = traffic.vehicles.filter(
				(vehicle) =>
					trafficBodyOverlapsTile(
						vehicle,
						intersection.centerX,
						intersection.centerZ,
						world.tileSize,
						world.worldSpan,
					),
			);
			const overlappingPairs = new Set<string>();
			for (let first = 0; first < vehiclesInside.length; first += 1) {
				for (let second = first + 1; second < vehiclesInside.length; second += 1) {
					if (
						!trafficBodiesOverlap(
							vehiclesInside[first],
							vehiclesInside[second],
							world.worldSpan,
						)
					) {
						continue;
					}
					const key = `${vehiclesInside[first].id}:${vehiclesInside[second].id}`;
					overlappingPairs.add(key);
					const streak = (overlapFrames.get(key) ?? 0) + 1;
					overlapFrames.set(key, streak);
					longestOverlapFrames = Math.max(longestOverlapFrames, streak);
				}
			}
			for (const key of overlapFrames.keys()) {
				if (!overlappingPairs.has(key)) overlapFrames.set(key, 0);
			}
		}

		expect(longestOverlapFrames).toBeLessThan(10);
	}, 15_000);

	it('uses model-sized collision capsules and slower meadow handling', () => {
		const world = generateWorld(6767);
		const roadTraffic = createTrafficSimulation({ layout: world, seed: 6767, maxVehicles: 1 });
		const meadowTraffic = createTrafficSimulation({
			layout: world,
			seed: 6767,
			maxVehicles: 1,
			terrain: { surfaceAt: () => 'meadow' },
		});
		for (let step = 0; step < 30; step += 1) {
			roadTraffic.step(0.1);
			meadowTraffic.step(0.1);
		}
		expect(roadTraffic.vehicles[0].speed).toBeGreaterThan(meadowTraffic.vehicles[0].speed);
		expect(meadowTraffic.vehicles[0].surface).toBe('meadow');

		const traffic = createTrafficSimulation({
			layout: world,
			seed: 6767,
			maxVehicles: DEFAULT_TRAFFIC_VEHICLE_COUNT,
		});
		const motorcycle = traffic.vehicles.find((vehicle) => vehicle.kind === 'motorcycle');
		const bus = traffic.vehicles.find((vehicle) => vehicle.kind === 'bus');
		if (!motorcycle || !bus) throw new Error('Expected vehicle classes missing.');
		expect(bus.collisionHalfLength).toBeGreaterThan(motorcycle.collisionHalfLength * 3);
		expect(bus.collisionRadius).toBeGreaterThan(motorcycle.collisionRadius);
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
