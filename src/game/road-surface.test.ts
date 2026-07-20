import { describe, expect, it } from 'vitest';

import { buildRoadDecorations, buildRoadSurface } from './road-surface';
import { createTerrainIndex, type RoadLayout, type TileCoordinate } from './world';

describe('road surface', () => {
	function roadLayout(roads: TileCoordinate[], gridSize = 2): RoadLayout {
		return {
			gridSize,
			tileSize: 8,
			worldSpan: gridSize * 8,
			roads,
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
		const terrain = createTerrainIndex(layout);

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
		const terrain = createTerrainIndex(layout);

		expect({
			joinedGeometry: coversPoint(surface, -13, -3),
			joinedTerrain: terrain.surfaceAt(11, -3),
			farMeadow: terrain.surfaceAt(9, -1),
		}).toEqual({ joinedGeometry: true, joinedTerrain: 'road', farMeadow: 'meadow' });
	});

	it('adds dashed center markings, edge lines, and pavement to a straight road', () => {
		const decorations = buildRoadDecorations(
			roadLayout(
				[
					{ x: 0, z: 1 },
					{ x: 1, z: 1 },
					{ x: 2, z: 1 },
				],
				3,
			),
		);

		expect({
			centerDashes: decorations.centerDashes.length,
			edgeLines: decorations.edgeLines.length,
			pavementSections: decorations.pavements.length,
			crosswalkStripes: decorations.crosswalkStripes.length,
		}).toEqual({
			centerDashes: 6,
			edgeLines: 6,
			pavementSections: 6,
			crosswalkStripes: 0,
		});
	});

	it('adds separated crosswalk stripes outside a four-way intersection', () => {
		const layout = roadLayout(
			[
				{ x: 2, z: 2 },
				{ x: 1, z: 2 },
				{ x: 3, z: 2 },
				{ x: 2, z: 1 },
				{ x: 2, z: 3 },
			],
			5,
		);
		const decorations = buildRoadDecorations(layout);
		const approachEdgeBars = decorations.crosswalkStripes.every((stripe) =>
			Math.max(Math.abs(stripe.x), Math.abs(stripe.z)) >= 4.2,
		);
		const eastStripes = decorations.crosswalkStripes
			.filter((stripe) => stripe.x > 0)
			.sort((first, second) => first.x - second.x);
		const eastStripeGaps = eastStripes
			.slice(1)
			.map((stripe, index) => stripe.x - eastStripes[index].x);
		const eastWestStripesSpanRoad = eastStripes.every(
			(stripe) => stripe.depth > stripe.width,
		);
		const northSouthStripes = decorations.crosswalkStripes.filter((stripe) => stripe.z > 0);
		const northSouthStripesSpanRoad = northSouthStripes.every(
			(stripe) => stripe.width > stripe.depth,
		);
		const pedestrianSizedStripes = decorations.crosswalkStripes.every((stripe) => {
			const longSide = Math.max(stripe.width, stripe.depth);
			const shortSide = Math.min(stripe.width, stripe.depth);
			return shortSide >= layout.tileSize * 0.06 && longSide / shortSide <= 6;
		});

		expect({
			centerDashes: decorations.centerDashes.length,
			crosswalkStripes: decorations.crosswalkStripes.length,
			approachEdgeBars,
			eastStripeCount: eastStripes.length,
			visibleStripeGaps: eastStripeGaps.every((gap) => gap >= 0.24),
			eastWestStripesSpanRoad,
			northSouthStripesSpanRoad,
			pedestrianSizedStripes,
		}).toEqual({
			centerDashes: 0,
			crosswalkStripes: 20,
			approachEdgeBars: true,
			eastStripeCount: 5,
			visibleStripeGaps: true,
			eastWestStripesSpanRoad: true,
			northSouthStripesSpanRoad: true,
			pedestrianSizedStripes: true,
		});
	});

	it('follows rounded road joins with curved edge markings and pavement', () => {
		const decorations = buildRoadDecorations(
			roadLayout(
				[
					{ x: 1, z: 1 },
					{ x: 2, z: 1 },
					{ x: 2, z: 2 },
				],
				3,
			),
		);
		const isCurvedSegment = (rotation = 0) =>
			Math.abs(Math.sin(rotation * 2)) > 0.01;

		expect({
			curvedEdgeSegments: decorations.edgeLines.filter((line) =>
				isCurvedSegment(line.rotation),
			).length,
			curvedPavementSegments: decorations.pavements.filter((pavement) =>
				isCurvedSegment(pavement.rotation),
			).length,
		}).toEqual({ curvedEdgeSegments: 6, curvedPavementSegments: 6 });
	});

	it('continues dashed center markings through a simple road turn', () => {
		const decorations = buildRoadDecorations(
			roadLayout(
				[
					{ x: 2, z: 2 },
					{ x: 1, z: 2 },
					{ x: 2, z: 3 },
				],
				5,
			),
		);

		expect(
			decorations.centerDashes.filter((dash) => Math.abs(Math.sin((dash.rotation ?? 0) * 2)) > 0.01),
		).toHaveLength(3);
	});
});
