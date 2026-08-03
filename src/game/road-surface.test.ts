import { describe, expect, it } from 'vitest';

import { buildRoadDecorations, buildRoadSurface } from './road-surface';
import { createTerrainIndex, type RoadLayout, type RoadTile } from './world';

describe('road surface', () => {
	function roadLayout(roads: RoadTile[], gridSize = 2): RoadLayout {
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

	it('widens four-lane arterials and adds same-direction lane dividers', () => {
		const layout = roadLayout(
			Array.from({ length: 5 }, (_, x) => ({
				x,
				z: 2,
				roadClass: 'arterial' as const,
			})),
			5,
		);
		const terrain = createTerrainIndex(layout);
		const decorations = buildRoadDecorations(layout);

		expect({
			insideOuterLane: terrain.isRoadAt(0, 6),
			outsideShoulder: terrain.isRoadAt(0, 7.3),
			centerDashes: decorations.centerDashes.length,
			laneDashes: decorations.laneDashes.length,
		}).toEqual({
			insideOuterLane: true,
			outsideShoulder: false,
			centerDashes: 10,
			laneDashes: 20,
		});
	});

	it('keeps pavement outside a mixed-width arterial intersection', () => {
		const layout = roadLayout(
			[
				{ x: 2, z: 2 },
				{ x: 1, z: 2, roadClass: 'arterial' as const },
				{ x: 3, z: 2, roadClass: 'arterial' as const },
				{ x: 2, z: 1, roadClass: 'arterial' as const },
				{ x: 2, z: 3, roadClass: 'arterial' as const },
				{ x: 0, z: 2, roadClass: 'arterial' as const },
				{ x: 4, z: 2, roadClass: 'arterial' as const },
				{ x: 2, z: 0, roadClass: 'arterial' as const },
				{ x: 2, z: 4, roadClass: 'arterial' as const },
			],
			5,
		);
		const decorations = buildRoadDecorations(layout);
		const arterialHalfWidth = 7.2;
		const pavementInsideIntersection = decorations.pavements.filter((pavement) => {
			const halfWidth = pavement.width / 2;
			const halfDepth = pavement.depth / 2;
			return (
				pavement.x + halfWidth > -arterialHalfWidth &&
				pavement.x - halfWidth < arterialHalfWidth &&
				pavement.z + halfDepth > -arterialHalfWidth &&
				pavement.z - halfDepth < arterialHalfWidth
			);
		});

		expect(pavementInsideIntersection).toEqual([]);
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
			.filter((stripe) => stripe.x > 4.2)
			.sort((first, second) => first.z - second.z);
		const eastStripeGaps = eastStripes
			.slice(1)
			.map((stripe, index) => stripe.z - eastStripes[index].z);
		const eastStripesShareRoadAnchor = eastStripes.every(
			(stripe) => Math.abs(stripe.x - eastStripes[0].x) < 0.001,
		);
		const northSouthStripes = decorations.crosswalkStripes.filter((stripe) => stripe.z > 4.2);
		const renderedDimensions = (stripe: (typeof decorations.crosswalkStripes)[number]) =>
			Math.abs(Math.sin(stripe.rotation ?? 0)) > 0.5
				? { width: stripe.depth, depth: stripe.width }
				: { width: stripe.width, depth: stripe.depth };
		const eastWestStripesRenderAcrossLane = eastStripes.every((stripe) => {
			const dimensions = renderedDimensions(stripe);
			return dimensions.width > dimensions.depth;
		});
		const northSouthStripesRenderAcrossLane = northSouthStripes.every((stripe) => {
			const dimensions = renderedDimensions(stripe);
			return dimensions.depth > dimensions.width;
		});
		const pedestrianSizedStripes = decorations.crosswalkStripes.every((stripe) => {
			const longSide = Math.max(stripe.width, stripe.depth);
			const shortSide = Math.min(stripe.width, stripe.depth);
			return (
				shortSide >= layout.tileSize * 0.04 &&
				shortSide < layout.tileSize * 0.06 &&
				longSide / shortSide <= 7
			);
		});
		const rotatedForPedestrianLane = decorations.crosswalkStripes.every(
			(stripe) => Math.abs((stripe.rotation ?? 0) - Math.PI / 2) < 0.001,
		);
		const curvedPavementsInsideIntersection = decorations.pavements.filter(
			(pavement) => Math.abs(Math.sin((pavement.rotation ?? 0) * 2)) > 0.01,
		).length;

		expect({
			centerDashes: decorations.centerDashes.length,
			crosswalkStripes: decorations.crosswalkStripes.length,
			approachEdgeBars,
			eastStripeCount: eastStripes.length,
			eastStripesShareRoadAnchor,
			visibleStripeGaps: eastStripeGaps.every((gap) => gap >= layout.tileSize * 0.1),
			eastWestStripesRenderAcrossLane,
			northSouthStripesRenderAcrossLane,
			pedestrianSizedStripes,
			rotatedForPedestrianLane,
			curvedPavementsInsideIntersection,
		}).toEqual({
			centerDashes: 0,
			crosswalkStripes: 28,
			approachEdgeBars: true,
			eastStripeCount: 7,
			eastStripesShareRoadAnchor: true,
			visibleStripeGaps: true,
			eastWestStripesRenderAcrossLane: true,
			northSouthStripesRenderAcrossLane: true,
			pedestrianSizedStripes: true,
			rotatedForPedestrianLane: true,
			curvedPavementsInsideIntersection: 0,
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
