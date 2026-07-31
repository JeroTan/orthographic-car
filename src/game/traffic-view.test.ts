import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { attachPackedModel, type TrafficVisual, type WheelAxle } from './traffic-view';
import { getTrafficVehicleModel } from './traffic-vehicle-catalog';

function wheelAxle(): WheelAxle {
	return {
		pivots: [new THREE.Group(), new THREE.Group()],
		wheels: [],
	};
}

describe('traffic vehicle view', () => {
	it('removes generated wheels after source model with embedded wheels attaches', () => {
		const frontAxle = wheelAxle();
		const rearAxle = wheelAxle();
		const visual: TrafficVisual = {
			group: new THREE.Group(),
			motion: new THREE.Group(),
			chassis: new THREE.Group(),
			fallback: new THREE.Group(),
			modelAnchor: new THREE.Group(),
			frontAxle,
			rearAxle,
			model: getTrafficVehicleModel('honda-civic'),
		};
		const geometry = new THREE.BoxGeometry();
		const material = new THREE.MeshBasicMaterial();

		attachPackedModel(
			visual,
			{
				geometry,
				centerMeters: new THREE.Vector3(0, 0.5, 0),
				halfExtentMeters: new THREE.Vector3(0.5, 0.5, 0.5),
			},
			material,
		);

		expect(visual.fallback.visible).toBe(false);
		expect([...frontAxle.pivots, ...rearAxle.pivots].every((pivot) => !pivot.visible)).toBe(
			true,
		);

		geometry.dispose();
		material.dispose();
	});
});
