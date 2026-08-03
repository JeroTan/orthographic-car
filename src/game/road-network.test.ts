import { describe, expect, it } from 'vitest';

import {
	choosePlayerRoadSpawn,
	lanesPerDirection,
	rightHandLaneOffset,
	roadLaneWidth,
	roadProfileFor,
	roadWidth,
} from './road-network';
import { createTerrainIndex, type RoadLayout } from './world';

describe('road network profiles', () => {
	it('defines two- and four-lane hierarchy through one lane-count profile', () => {
		const local = roadProfileFor('local');
		const arterial = roadProfileFor('arterial');

		expect({
			localLanes: local.laneCount,
			arterialLanes: arterial.laneCount,
			localRank: local.rank,
			arterialRank: arterial.rank,
			localDirections: lanesPerDirection(local),
			arterialDirections: lanesPerDirection(arterial),
			arterialWidth: roadWidth(arterial, 8),
		}).toEqual({
			localLanes: 2,
			arterialLanes: 4,
			localRank: 0,
			arterialRank: 1,
			localDirections: 1,
			arterialDirections: 2,
			arterialWidth: 14.4,
		});
		expect(roadLaneWidth(arterial, 8)).toBeCloseTo(3.36);
	});

	it('places player in outer right-hand lane of nearby arterial', () => {
		const layout: RoadLayout = {
			gridSize: 9,
			tileSize: 8,
			worldSpan: 72,
			roads: Array.from({ length: 9 }, (_, x) => ({
				x,
				z: 4,
				roadClass: 'arterial' as const,
			})),
		};
		const spawn = choosePlayerRoadSpawn(layout);
		const profile = roadProfileFor(spawn.roadClass);
		const terrain = createTerrainIndex(layout);
		const tileCenterX = (spawn.tileX + 0.5) * layout.tileSize - layout.worldSpan / 2;
		const tileCenterZ = (spawn.tileZ + 0.5) * layout.tileSize - layout.worldSpan / 2;
		const forwardX = Math.sin(spawn.heading);
		const forwardZ = Math.cos(spawn.heading);
		const rightX = forwardZ;
		const rightZ = -forwardX;
		const signedRightOffset =
			(spawn.x - tileCenterX) * rightX + (spawn.z - tileCenterZ) * rightZ;

		expect({
			roadClass: spawn.roadClass,
			laneIndex: spawn.laneIndex,
			laneOffset: spawn.laneOffset,
			signedRightOffset,
			surface: terrain.surfaceAt(spawn.x, spawn.z),
		}).toEqual({
			roadClass: 'arterial',
			laneIndex: 1,
			laneOffset: rightHandLaneOffset(profile, layout.tileSize, 1),
			signedRightOffset: rightHandLaneOffset(profile, layout.tileSize, 1),
			surface: 'road',
		});
	});
});
