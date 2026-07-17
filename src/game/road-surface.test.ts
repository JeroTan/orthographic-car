import { describe, expect, it } from 'vitest';

import { buildRoadSurface } from './road-surface';
import { createRoadIndex, type TileCoordinate, type WorldLayout } from './world';

describe('road surface', () => {
	function roadLayout(roads: TileCoordinate[], gridSize = 2): WorldLayout {
		return {
			gridSize,
			tileSize: 8,
			worldSpan: gridSize * 8,
			roads,
			props: [],
			grass: [],
		};
	}

	function coversPoint(
		surface: ReturnType<typeof buildRoadSurface>,
		x: number,
		z: number,
	): boolean {
		for (let offset = 0; offset < surface.indices.length; offset += 3) {
			const points = surface.indices.slice(offset, offset + 3).map((index) => ({
				x: surface.positions[index * 3],
				z: surface.positions[index * 3 + 2],
			}));
			const [a, b, c] = points;
			const area = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
			const weightA = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / area;
			const weightB = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / area;
			const weightC = 1 - weightA - weightB;
			if (weightA >= 0 && weightB >= 0 && weightC >= 0) return true;
		}
		return false;
	}

	it('joins a four-tile road block into one shared surface', () => {
		const layout = roadLayout([
				{ x: 0, z: 0 },
				{ x: 1, z: 0 },
				{ x: 0, z: 1 },
				{ x: 1, z: 1 },
			]);

		const surface = buildRoadSurface(layout);

		expect({
			vertices: surface.positions.length / 3,
			triangles: surface.indices.length / 3,
		}).toEqual({ vertices: 9, triangles: 8 });
	});

	it('bridges a three-tile corner with a compact rounded road join', () => {
		const layout = roadLayout([
				{ x: 0, z: 0 },
				{ x: 1, z: 0 },
				{ x: 1, z: 1 },
			]);

		const surface = buildRoadSurface(layout);
		const terrain = createRoadIndex(layout);

		expect({
			joinedCorner: coversPoint(surface, -1, 1),
			joinedCornerTerrain: terrain.surfaceAt(-1, 1),
			wideShoulder: coversPoint(surface, -2, 1.5),
			wideShoulderTerrain: terrain.surfaceAt(-2, 1.5),
			emptyMeadow: coversPoint(surface, -3, 3),
		}).toEqual({
			joinedCorner: true,
			joinedCornerTerrain: 'road',
			wideShoulder: false,
			wideShoulderTerrain: 'meadow',
			emptyMeadow: false,
		});
	});

	it('bridges three-tile corners across the repeating map seam', () => {
		const layout = roadLayout(
			[
				{ x: 2, z: 0 },
				{ x: 0, z: 0 },
				{ x: 0, z: 1 },
			],
			3,
		);
		const surface = buildRoadSurface(layout);
		const terrain = createRoadIndex(layout);

		expect({
			joinedGeometry: coversPoint(surface, -13, -3),
			joinedTerrain: terrain.surfaceAt(11, -3),
			farMeadow: terrain.surfaceAt(9, -1),
		}).toEqual({ joinedGeometry: true, joinedTerrain: 'road', farMeadow: 'meadow' });
	});
});
