import * as THREE from 'three';

import {
	createTrafficSimulation,
	DEFAULT_TRAFFIC_VEHICLE_COUNT,
	type TrafficVehicleKind,
	type TrafficPlayerImpact,
	type TrafficVehicleState,
} from './traffic';
import type { VehicleImpactBody } from './vehicle-impact';
import type { RoadLayout } from './world';

const TRAFFIC_RENDER_DISTANCE = 125;
const TRAFFIC_WHEEL_SPIN_FACTOR = 0.8;

interface TrafficSpec {
	bodyWidth: number;
	bodyLength: number;
	bodyHeight: number;
	wheelRadius: number;
	wheelWidth: number;
	cabinWidth: number;
	cabinLength: number;
	cabinHeight: number;
	cabinOffset: number;
	colors: readonly [number, number];
	wheelPositions: readonly (readonly [number, number])[];
}

const TRAFFIC_SPECS: Readonly<Record<TrafficVehicleKind, TrafficSpec>> = {
	compact: {
		bodyWidth: 1.65,
		bodyLength: 3.5,
		bodyHeight: 0.62,
		wheelRadius: 0.34,
		wheelWidth: 0.23,
		cabinWidth: 1.45,
		cabinLength: 1.55,
		cabinHeight: 0.72,
		cabinOffset: -0.28,
		colors: [0x3e82b6, 0xa9d7e4],
		wheelPositions: [
			[-0.72, -1.18],
			[0.72, -1.18],
			[-0.72, 1.18],
			[0.72, 1.18],
		],
	},
	bike: {
		bodyWidth: 0.42,
		bodyLength: 1.7,
		bodyHeight: 0.24,
		wheelRadius: 0.28,
		wheelWidth: 0.14,
		cabinWidth: 0,
		cabinLength: 0,
		cabinHeight: 0,
		cabinOffset: 0,
		colors: [0xd45f45, 0xf2c14e],
		wheelPositions: [
			[0, -0.72],
			[0, 0.72],
		],
	},
	van: {
		bodyWidth: 1.92,
		bodyLength: 4.7,
		bodyHeight: 1.35,
		wheelRadius: 0.4,
		wheelWidth: 0.28,
		cabinWidth: 1.72,
		cabinLength: 2.15,
		cabinHeight: 0.48,
		cabinOffset: 0.55,
		colors: [0xd8d6c7, 0x9da7a5],
		wheelPositions: [
			[-0.82, -1.45],
			[0.82, -1.45],
			[-0.82, 1.45],
			[0.82, 1.45],
		],
	},
	suv: {
		bodyWidth: 1.95,
		bodyLength: 4.35,
		bodyHeight: 0.85,
		wheelRadius: 0.4,
		wheelWidth: 0.28,
		cabinWidth: 1.7,
		cabinLength: 2.05,
		cabinHeight: 0.82,
		cabinOffset: -0.2,
		colors: [0x4f7658, 0xc6d7c2],
		wheelPositions: [
			[-0.84, -1.42],
			[0.84, -1.42],
			[-0.84, 1.42],
			[0.84, 1.42],
		],
	},
	truck: {
		bodyWidth: 2.25,
		bodyLength: 5.9,
		bodyHeight: 0.85,
		wheelRadius: 0.43,
		wheelWidth: 0.3,
		cabinWidth: 2.05,
		cabinLength: 1.55,
		cabinHeight: 1.05,
		cabinOffset: 1.35,
		colors: [0xc97835, 0xf1c56b],
		wheelPositions: [
			[-0.98, -1.8],
			[0.98, -1.8],
			[-0.98, 1.72],
			[0.98, 1.72],
		],
	},
};

interface TrafficVisual {
	group: THREE.Group;
	body: THREE.Group;
	wheels: THREE.Mesh[];
}

interface SharedTrafficAssets {
	bodyGeometry: Map<TrafficVehicleKind, THREE.BufferGeometry>;
	cabinGeometry: Map<TrafficVehicleKind, THREE.BufferGeometry>;
	wheelGeometry: Map<TrafficVehicleKind, THREE.BufferGeometry>;
	bodyMaterials: Map<TrafficVehicleKind, THREE.Material>;
	trimMaterials: Map<TrafficVehicleKind, THREE.Material>;
	glass: THREE.Material;
	tire: THREE.Material;
	light: THREE.Material;
	tail: THREE.Material;
	metal: THREE.Material;
	shadowGeometry: THREE.BufferGeometry;
	shadow: THREE.Material;
	extraGeometries: Set<THREE.BufferGeometry>;
}

function createSharedAssets(): SharedTrafficAssets {
	const bodyGeometry = new Map<TrafficVehicleKind, THREE.BufferGeometry>();
	const cabinGeometry = new Map<TrafficVehicleKind, THREE.BufferGeometry>();
	const wheelGeometry = new Map<TrafficVehicleKind, THREE.BufferGeometry>();
	const bodyMaterials = new Map<TrafficVehicleKind, THREE.Material>();
	const trimMaterials = new Map<TrafficVehicleKind, THREE.Material>();
	for (const kind of Object.keys(TRAFFIC_SPECS) as TrafficVehicleKind[]) {
		const spec = TRAFFIC_SPECS[kind];
		bodyGeometry.set(kind, new THREE.BoxGeometry(spec.bodyWidth, spec.bodyHeight, spec.bodyLength));
		if (spec.cabinWidth > 0) {
			cabinGeometry.set(kind, new THREE.BoxGeometry(spec.cabinWidth, spec.cabinHeight, spec.cabinLength));
		}
		const wheel = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, spec.wheelWidth, 8);
		wheel.rotateZ(Math.PI / 2);
		wheelGeometry.set(kind, wheel);
		bodyMaterials.set(kind, new THREE.MeshLambertMaterial({ color: spec.colors[0] }));
		trimMaterials.set(kind, new THREE.MeshLambertMaterial({ color: spec.colors[1] }));
	}
	return {
		bodyGeometry,
		cabinGeometry,
		wheelGeometry,
		bodyMaterials,
		trimMaterials,
		glass: new THREE.MeshLambertMaterial({ color: 0x9bbfc2 }),
		tire: new THREE.MeshLambertMaterial({ color: 0x262c2d }),
		light: new THREE.MeshBasicMaterial({ color: 0xffed9d }),
		tail: new THREE.MeshBasicMaterial({ color: 0xc73e36 }),
		metal: new THREE.MeshLambertMaterial({ color: 0xbfc5bd }),
		shadowGeometry: new THREE.CircleGeometry(2.4, 12),
		shadow: new THREE.MeshBasicMaterial({
			color: 0x24372d,
			transparent: true,
			opacity: 0.18,
			depthWrite: false,
		}),
		extraGeometries: new Set(),
	};
}

function addBikeRider(group: THREE.Group, assets: SharedTrafficAssets): void {
	const torsoGeometry = new THREE.BoxGeometry(0.3, 0.62, 0.26);
	assets.extraGeometries.add(torsoGeometry);
	const torso = new THREE.Mesh(torsoGeometry, assets.trimMaterials.get('bike'));
	torso.position.y = 1.02;
	group.add(torso);
	const headGeometry = new THREE.SphereGeometry(0.2, 6, 4);
	assets.extraGeometries.add(headGeometry);
	const head = new THREE.Mesh(headGeometry, assets.glass);
	head.position.y = 1.52;
	group.add(head);
	const handlebarGeometry = new THREE.BoxGeometry(0.72, 0.08, 0.08);
	assets.extraGeometries.add(handlebarGeometry);
	const handlebar = new THREE.Mesh(handlebarGeometry, assets.metal);
	handlebar.position.set(0, 0.78, 0.62);
	group.add(handlebar);
}

function addTrafficVehicle(
	scene: THREE.Scene,
	assets: SharedTrafficAssets,
	state: TrafficVehicleState,
): TrafficVisual {
	const spec = TRAFFIC_SPECS[state.kind];
	const group = new THREE.Group();
	const vehicleBody = new THREE.Group();
	group.add(vehicleBody);
	const body = new THREE.Mesh(assets.bodyGeometry.get(state.kind), assets.bodyMaterials.get(state.kind));
	body.position.y = spec.wheelRadius + spec.bodyHeight / 2;
	vehicleBody.add(body);

	const cabinGeometry = assets.cabinGeometry.get(state.kind);
	if (cabinGeometry) {
		const cabin = new THREE.Mesh(cabinGeometry, state.kind === 'van' ? assets.trimMaterials.get(state.kind) : assets.glass);
		cabin.position.set(0, spec.wheelRadius + spec.bodyHeight + spec.cabinHeight / 2, spec.cabinOffset);
		vehicleBody.add(cabin);
	}

	if (state.kind === 'truck') {
		const cargoGeometry = new THREE.BoxGeometry(spec.bodyWidth * 0.96, 1.62, 2.7);
		assets.extraGeometries.add(cargoGeometry);
		const cargo = new THREE.Mesh(
			cargoGeometry,
			assets.trimMaterials.get(state.kind),
		);
		cargo.position.set(0, 1.48, -0.82);
		vehicleBody.add(cargo);
	}
	if (state.kind === 'bike') addBikeRider(vehicleBody, assets);

	const wheels: THREE.Mesh[] = [];
	const wheelGeometry = assets.wheelGeometry.get(state.kind);
	for (const [x, z] of spec.wheelPositions) {
		const wheel = new THREE.Mesh(wheelGeometry, assets.tire);
		wheel.position.set(x, spec.wheelRadius, z);
		vehicleBody.add(wheel);
		wheels.push(wheel);
	}

	if (state.kind !== 'bike') {
		const frontLightGeometry = new THREE.BoxGeometry(spec.bodyWidth * 0.16, 0.12, 0.06);
		assets.extraGeometries.add(frontLightGeometry);
		const frontLight = new THREE.Mesh(frontLightGeometry, assets.light);
		for (const x of [-spec.bodyWidth * 0.3, spec.bodyWidth * 0.3]) {
			frontLight.position.set(x, spec.wheelRadius + spec.bodyHeight * 0.6, spec.bodyLength / 2 + 0.03);
			vehicleBody.add(frontLight.clone());
		}
		const tailLightGeometry = new THREE.BoxGeometry(spec.bodyWidth * 0.14, 0.1, 0.06);
		assets.extraGeometries.add(tailLightGeometry);
		const tailLight = new THREE.Mesh(tailLightGeometry, assets.tail);
		for (const x of [-spec.bodyWidth * 0.3, spec.bodyWidth * 0.3]) {
			tailLight.position.set(x, spec.wheelRadius + spec.bodyHeight * 0.6, -spec.bodyLength / 2 - 0.03);
			vehicleBody.add(tailLight.clone());
		}
	}

	const shadow = new THREE.Mesh(assets.shadowGeometry, assets.shadow);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.y = 0.02;
	shadow.scale.set(spec.bodyWidth * 0.72, spec.bodyLength * 0.42, 1);
	group.add(shadow);
	group.position.y = 0.04;
	scene.add(group);
	return { group, body: vehicleBody, wheels };
}

function wrappedDelta(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

export interface TrafficView {
	step(deltaSeconds: number, player?: VehicleImpactBody): void;
	resolvePlayerImpacts(player: VehicleImpactBody): readonly TrafficPlayerImpact[];
	render(player: Pick<TrafficVehicleState, 'x' | 'z'>): boolean;
	destroy(): void;
}

export function addTrafficView(
	scene: THREE.Scene,
	layout: RoadLayout,
	seed: number,
	maxVehicles: number = DEFAULT_TRAFFIC_VEHICLE_COUNT,
): TrafficView {
	const simulation = createTrafficSimulation({ layout, seed, maxVehicles });
	if (simulation.vehicles.length === 0) {
		return {
			step: () => undefined,
			resolvePlayerImpacts: () => [],
			render: () => false,
			destroy: () => undefined,
		};
	}
	const assets = createSharedAssets();
	const visuals = simulation.vehicles.map((state) => addTrafficVehicle(scene, assets, state));
	let destroyed = false;
	let visualDeltaSeconds = 0;

	return {
		step(deltaSeconds, player) {
			if (destroyed || visuals.length === 0) return;
			visualDeltaSeconds = Math.min(
				0.25,
				visualDeltaSeconds + Math.max(0, Math.min(deltaSeconds, 0.25)),
			);
			simulation.step(deltaSeconds, player);
		},
		resolvePlayerImpacts(player) {
			if (destroyed || visuals.length === 0) return [];
			return simulation.resolvePlayerImpacts(player);
		},
		render(player) {
			if (destroyed || visuals.length === 0) return false;
			const renderDeltaSeconds = visualDeltaSeconds;
			visualDeltaSeconds = 0;
			let effectsActive = false;
			for (let index = 0; index < simulation.vehicles.length; index += 1) {
				const state = simulation.vehicles[index];
				const visual = visuals[index];
				const relativeX = wrappedDelta(state.x - player.x, layout.worldSpan);
				const relativeZ = wrappedDelta(state.z - player.z, layout.worldSpan);
				visual.group.position.set(player.x + relativeX, 0.04, player.z + relativeZ);
				visual.group.rotation.y = state.heading;
				const response = 1 - Math.exp(-8 * renderDeltaSeconds);
				const accelerationStretch = Math.max(0, state.longitudinalLoad);
				const brakingSquash = Math.max(0, -state.longitudinalLoad);
				const damage = THREE.MathUtils.clamp(state.damage, 0, 1);
				visual.body.position.y = state.verticalOffset;
				visual.body.rotation.x = THREE.MathUtils.lerp(
					visual.body.rotation.x,
					-state.longitudinalLoad * 0.055 - damage * 0.018,
					response,
				);
				visual.body.rotation.z = THREE.MathUtils.lerp(
					visual.body.rotation.z,
					state.lateralLoad * 0.065 + damage * 0.025,
					response,
				);
				visual.body.scale.y = THREE.MathUtils.lerp(
					visual.body.scale.y,
					1 -
						accelerationStretch * 0.025 -
						brakingSquash * 0.075 -
						state.impactIntensity * 0.06 -
						damage * 0.06,
					response,
				);
				visual.body.scale.z = THREE.MathUtils.lerp(
					visual.body.scale.z,
					1 + accelerationStretch * 0.045 + state.impactIntensity * 0.08 + damage * 0.035,
					response,
				);
				visual.group.visible =
					relativeX * relativeX + relativeZ * relativeZ < TRAFFIC_RENDER_DISTANCE ** 2;
				const wheelSpeed = Math.hypot(state.velocityX, state.velocityZ);
				for (const wheel of visual.wheels) {
					wheel.rotation.x -= wheelSpeed * TRAFFIC_WHEEL_SPIN_FACTOR * renderDeltaSeconds;
				}
				effectsActive ||= state.verticalOffset > 0 || state.impactIntensity > 0;
			}
			return effectsActive;
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			for (const visual of visuals) scene.remove(visual.group);
			for (const geometry of assets.bodyGeometry.values()) geometry.dispose();
			for (const geometry of assets.cabinGeometry.values()) geometry.dispose();
			for (const geometry of assets.wheelGeometry.values()) geometry.dispose();
			for (const geometry of assets.extraGeometries) geometry.dispose();
			assets.shadowGeometry.dispose();
			for (const material of assets.bodyMaterials.values()) material.dispose();
			for (const material of assets.trimMaterials.values()) material.dispose();
			assets.glass.dispose();
			assets.tire.dispose();
			assets.light.dispose();
			assets.tail.dispose();
			assets.metal.dispose();
			assets.shadow.dispose();
		},
	};
}
