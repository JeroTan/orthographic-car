import * as THREE from 'three';

import {
	createTrafficSimulation,
	DEFAULT_TRAFFIC_VEHICLE_COUNT,
	type TrafficPlayerImpact,
	type TrafficVehicleState,
} from './traffic';
import { loadTrafficModels, type PackedTrafficModel } from './traffic-model';
import {
	getTrafficVehicleModel,
	type TrafficVehicleModel,
} from './traffic-vehicle-catalog';
import { hasVehicleCrashMotion } from './vehicle-crash';
import { WORLD_METERS_PER_UNIT, type CollisionQuery, type TerrainQuery } from './vehicle';
import type { VehicleImpactBody } from './vehicle-impact';
import type { RoadLayout } from './world';

const TRAFFIC_RENDER_DISTANCE = 125;
const TRAFFIC_WHEEL_SPIN_FACTOR = 0.8;
const TRAFFIC_TRAIL_POOL_SIZE = 120;
const TRAFFIC_SMOKE_POOL_SIZE = 56;

interface WheelAxle {
	pivots: THREE.Group[];
	wheels: THREE.Mesh[];
}

interface TrafficVisual {
	group: THREE.Group;
	motion: THREE.Group;
	chassis: THREE.Group;
	fallback: THREE.Group;
	modelAnchor: THREE.Group;
	frontAxle: WheelAxle;
	rearAxle: WheelAxle;
	model: TrafficVehicleModel;
}

interface SharedTrafficAssets {
	unitBox: THREE.BufferGeometry;
	unitWheel: THREE.BufferGeometry;
	bodyMaterials: Map<string, THREE.MeshLambertMaterial>;
	fallbackGlass: THREE.MeshLambertMaterial;
	tire: THREE.MeshLambertMaterial;
	shadowGeometry: THREE.BufferGeometry;
	shadow: THREE.MeshBasicMaterial;
}

interface TrailMark {
	active: boolean;
	age: number;
	lifetime: number;
	x: number;
	z: number;
	heading: number;
	intensity: number;
	length: number;
}

interface SmokePuff {
	active: boolean;
	age: number;
	lifetime: number;
	x: number;
	y: number;
	z: number;
	driftX: number;
	driftZ: number;
	size: number;
}

interface TireEffectSource {
	state: TrafficVehicleState;
	model: TrafficVehicleModel;
	x: number;
	z: number;
}

interface TrafficTireEffects {
	update(deltaSeconds: number, sources: readonly TireEffectSource[]): boolean;
	destroy(): void;
}

function worldUnits(meters: number): number {
	return meters / WORLD_METERS_PER_UNIT;
}

function createSharedAssets(states: readonly TrafficVehicleState[]): SharedTrafficAssets {
	const bodyMaterials = new Map<string, THREE.MeshLambertMaterial>();
	for (const state of states) {
		if (bodyMaterials.has(state.modelId)) continue;
		const model = getTrafficVehicleModel(state.modelId);
		bodyMaterials.set(
			state.modelId,
			new THREE.MeshLambertMaterial({ color: model.bodyColor, flatShading: true }),
		);
	}
	const unitWheel = new THREE.CylinderGeometry(1, 1, 0.7, 8);
	unitWheel.rotateZ(Math.PI / 2);
	return {
		unitBox: new THREE.BoxGeometry(1, 1, 1),
		unitWheel,
		bodyMaterials,
		fallbackGlass: new THREE.MeshLambertMaterial({ color: 0x98bcc0, flatShading: true }),
		tire: new THREE.MeshLambertMaterial({ color: 0x252b2c, flatShading: true }),
		shadowGeometry: new THREE.CircleGeometry(1, 12),
		shadow: new THREE.MeshBasicMaterial({
			color: 0x24372d,
			transparent: true,
			opacity: 0.18,
			depthWrite: false,
		}),
	};
}

function addFallbackBody(
	chassis: THREE.Group,
	assets: SharedTrafficAssets,
	model: TrafficVehicleModel,
): THREE.Group {
	const fallback = new THREE.Group();
	const width = worldUnits(model.widthMeters);
	const length = worldUnits(model.lengthMeters);
	const height = worldUnits(model.heightMeters);
	const body = new THREE.Mesh(
		assets.unitBox,
		assets.bodyMaterials.get(model.id) ?? assets.fallbackGlass,
	);
	body.position.y = height * 0.34;
	body.scale.set(width, height * 0.68, length);
	fallback.add(body);

	if (model.kind !== 'motorcycle' && model.kind !== 'truck' && model.kind !== 'bus') {
		const cabin = new THREE.Mesh(assets.unitBox, assets.fallbackGlass);
		cabin.position.set(0, height * 0.72, -length * 0.08);
		cabin.scale.set(width * 0.76, height * 0.45, length * 0.44);
		fallback.add(cabin);
	}
	chassis.add(fallback);
	return fallback;
}

function addWheel(
	motion: THREE.Group,
	assets: SharedTrafficAssets,
	model: TrafficVehicleModel,
	x: number,
	z: number,
	axle: WheelAxle,
): void {
	const pivot = new THREE.Group();
	pivot.position.set(x, worldUnits(model.wheelRadiusMeters), z);
	const wheel = new THREE.Mesh(assets.unitWheel, assets.tire);
	wheel.scale.set(
		worldUnits(model.widthMeters * 0.12) / 0.7,
		worldUnits(model.wheelRadiusMeters),
		worldUnits(model.wheelRadiusMeters),
	);
	pivot.add(wheel);
	motion.add(pivot);
	axle.pivots.push(pivot);
	axle.wheels.push(wheel);
}

function addFunctionalWheels(
	motion: THREE.Group,
	assets: SharedTrafficAssets,
	model: TrafficVehicleModel,
): { frontAxle: WheelAxle; rearAxle: WheelAxle } {
	const frontAxle: WheelAxle = { pivots: [], wheels: [] };
	const rearAxle: WheelAxle = { pivots: [], wheels: [] };
	const halfTrack = worldUnits(model.widthMeters * 0.39);
	const frontZ = worldUnits(model.wheelbaseMeters / 2);
	const rearZ = -frontZ;

	if (model.wheelCount === 2) {
		addWheel(motion, assets, model, 0, frontZ, frontAxle);
		addWheel(motion, assets, model, 0, rearZ, rearAxle);
		return { frontAxle, rearAxle };
	}
	for (const x of [-halfTrack, halfTrack]) addWheel(motion, assets, model, x, frontZ, frontAxle);
	for (const x of [-halfTrack, halfTrack]) addWheel(motion, assets, model, x, rearZ, rearAxle);
	if (model.wheelCount === 6) {
		for (const x of [-halfTrack, halfTrack]) {
			addWheel(motion, assets, model, x, rearZ * 0.4, rearAxle);
		}
	}
	return { frontAxle, rearAxle };
}

function addTrafficVehicle(
	scene: THREE.Scene,
	assets: SharedTrafficAssets,
	state: TrafficVehicleState,
): TrafficVisual {
	const model = getTrafficVehicleModel(state.modelId);
	const group = new THREE.Group();
	const motion = new THREE.Group();
	const chassis = new THREE.Group();
	const modelAnchor = new THREE.Group();
	group.add(motion);
	motion.add(chassis);
	chassis.add(modelAnchor);
	const fallback = addFallbackBody(chassis, assets, model);
	const { frontAxle, rearAxle } = addFunctionalWheels(motion, assets, model);
	const shadow = new THREE.Mesh(assets.shadowGeometry, assets.shadow);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.y = 0.02;
	shadow.scale.set(worldUnits(model.widthMeters) * 0.72, worldUnits(model.lengthMeters) * 0.42, 1);
	group.add(shadow);
	group.position.y = 0.04;
	scene.add(group);
	return { group, motion, chassis, fallback, modelAnchor, frontAxle, rearAxle, model };
}

function attachPackedModel(
	visual: TrafficVisual,
	packed: PackedTrafficModel,
	material: THREE.Material,
): void {
	const mesh = new THREE.Mesh(packed.geometry, material);
	mesh.position.copy(packed.centerMeters).multiplyScalar(worldUnits(1));
	mesh.scale.copy(packed.halfExtentMeters).multiplyScalar(worldUnits(1));
	visual.modelAnchor.add(mesh);
	visual.fallback.visible = false;
}

function wrappedDelta(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function addTrafficTireEffects(scene: THREE.Scene): TrafficTireEffects {
	const trailGeometry = new THREE.PlaneGeometry(1, 1);
	trailGeometry.rotateX(-Math.PI / 2);
	const trailMesh = new THREE.InstancedMesh(
		trailGeometry,
		new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.26,
			depthWrite: false,
			vertexColors: true,
		}),
		TRAFFIC_TRAIL_POOL_SIZE,
	);
	trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	trailMesh.frustumCulled = false;
	trailMesh.renderOrder = 1;
	trailMesh.visible = false;
	scene.add(trailMesh);
	const smokeGeometry = new THREE.DodecahedronGeometry(0.32, 0);
	const smokeMesh = new THREE.InstancedMesh(
		smokeGeometry,
		new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.2,
			depthWrite: false,
			vertexColors: true,
		}),
		TRAFFIC_SMOKE_POOL_SIZE,
	);
	smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	smokeMesh.frustumCulled = false;
	smokeMesh.renderOrder = 2;
	smokeMesh.visible = false;
	scene.add(smokeMesh);

	const trails: TrailMark[] = Array.from({ length: TRAFFIC_TRAIL_POOL_SIZE }, () => ({
		active: false, age: 0, lifetime: 0, x: 0, z: 0, heading: 0, intensity: 0, length: 0,
	}));
	const smoke: SmokePuff[] = Array.from({ length: TRAFFIC_SMOKE_POOL_SIZE }, () => ({
		active: false, age: 0, lifetime: 0, x: 0, y: 0, z: 0, driftX: 0, driftZ: 0, size: 0,
	}));
	const trailCooldown = new Map<number, number>();
	const smokeCooldown = new Map<number, number>();
	const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const rotation = new THREE.Quaternion();
	const euler = new THREE.Euler();
	const scale = new THREE.Vector3();
	const color = new THREE.Color();
	let trailCursor = 0;
	let smokeCursor = 0;

	for (let index = 0; index < trails.length; index += 1) {
		trailMesh.setMatrixAt(index, hiddenMatrix);
		trailMesh.setColorAt(index, color.setRGB(0.14, 0.16, 0.15));
	}
	for (let index = 0; index < smoke.length; index += 1) {
		smokeMesh.setMatrixAt(index, hiddenMatrix);
		smokeMesh.setColorAt(index, color.setRGB(0.25, 0.27, 0.26));
	}

	function rearWheelPosition(source: TireEffectSource, side: number): { x: number; z: number } {
		const localX = source.model.wheelCount === 2 ? 0 : side * worldUnits(source.model.widthMeters * 0.39);
		const localZ = -worldUnits(source.model.wheelbaseMeters / 2);
		return {
			x: source.x + Math.cos(source.state.heading) * localX + Math.sin(source.state.heading) * localZ,
			z: source.z - Math.sin(source.state.heading) * localX + Math.cos(source.state.heading) * localZ,
		};
	}

	function emitTrail(source: TireEffectSource, intensity: number): void {
		for (const side of source.model.wheelCount === 2 ? [0] : [-1, 1]) {
			const location = rearWheelPosition(source, side);
			const mark = trails[trailCursor];
			trailCursor = (trailCursor + 1) % trails.length;
			mark.active = true;
			mark.age = 0;
			mark.lifetime = 1.6 + intensity * 2.2;
			mark.x = location.x;
			mark.z = location.z;
			mark.heading = source.state.heading;
			mark.intensity = intensity;
			mark.length = 0.32 + Math.min(source.state.speed * 0.035, 0.72);
		}
	}

	function emitSmoke(source: TireEffectSource, intensity: number): void {
		for (const side of source.model.wheelCount === 2 ? [0] : [-1, 1]) {
			const location = rearWheelPosition(source, side);
			const puff = smoke[smokeCursor];
			const phase = smokeCursor * 2.37;
			smokeCursor = (smokeCursor + 1) % smoke.length;
			puff.active = true;
			puff.age = 0;
			puff.lifetime = 0.6 + intensity * 0.42;
			puff.x = location.x;
			puff.y = 0.34;
			puff.z = location.z;
			puff.driftX = Math.sin(phase) * 0.22;
			puff.driftZ = Math.cos(phase) * 0.22;
			puff.size = 0.5 + intensity * 0.5;
		}
	}

	return {
		update(deltaSeconds, sources) {
			for (const source of sources) {
				const state = source.state;
				const nextTrailCooldown = Math.max(0, (trailCooldown.get(state.id) ?? 0) - deltaSeconds);
				const nextSmokeCooldown = Math.max(0, (smokeCooldown.get(state.id) ?? 0) - deltaSeconds);
				const rollingTrail = state.surface === 'road' && state.speed > 5 ? 0.07 : 0;
				const trailIntensity = Math.max(rollingTrail, state.skidIntensity);
				if (trailIntensity > 0 && nextTrailCooldown === 0) {
					emitTrail(source, trailIntensity);
					trailCooldown.set(state.id, state.skidIntensity > 0.22 ? 0.05 : 0.14);
				} else {
					trailCooldown.set(state.id, nextTrailCooldown);
				}
				const smokeIntensity = Math.max(state.rearSlip, state.skidIntensity - 0.25);
				if (smokeIntensity > 0.28 && nextSmokeCooldown === 0) {
					emitSmoke(source, smokeIntensity);
					smokeCooldown.set(state.id, 0.08);
				} else {
					smokeCooldown.set(state.id, nextSmokeCooldown);
				}
			}

			let trailsActive = false;
			for (let index = 0; index < trails.length; index += 1) {
				const mark = trails[index];
				if (!mark.active) {
					trailMesh.setMatrixAt(index, hiddenMatrix);
					continue;
				}
				mark.age += deltaSeconds;
				const fade = Math.max(0, 1 - mark.age / mark.lifetime);
				if (fade === 0) {
					mark.active = false;
					trailMesh.setMatrixAt(index, hiddenMatrix);
					continue;
				}
				trailsActive = true;
				position.set(mark.x, 0.14, mark.z);
				rotation.setFromEuler(euler.set(0, mark.heading, 0));
				scale.set((0.1 + mark.intensity * 0.1) * fade, 1, mark.length);
				matrix.compose(position, rotation, scale);
				trailMesh.setMatrixAt(index, matrix);
				const shade = 0.14 + (1 - fade) * 0.3;
				trailMesh.setColorAt(index, color.setRGB(shade, shade * 1.05, shade));
			}
			trailMesh.instanceMatrix.needsUpdate = true;
			if (trailMesh.instanceColor) trailMesh.instanceColor.needsUpdate = true;
			trailMesh.visible = trailsActive;

			let smokeActive = false;
			for (let index = 0; index < smoke.length; index += 1) {
				const puff = smoke[index];
				if (!puff.active) {
					smokeMesh.setMatrixAt(index, hiddenMatrix);
					continue;
				}
				puff.age += deltaSeconds;
				const progress = puff.age / puff.lifetime;
				const fade = Math.max(0, 1 - progress);
				if (fade === 0) {
					puff.active = false;
					smokeMesh.setMatrixAt(index, hiddenMatrix);
					continue;
				}
				smokeActive = true;
				puff.x += puff.driftX * deltaSeconds;
				puff.y += 0.55 * deltaSeconds;
				puff.z += puff.driftZ * deltaSeconds;
				position.set(puff.x, puff.y, puff.z);
				rotation.identity();
				scale.setScalar(puff.size * (0.55 + progress) * Math.min(1, fade * 3));
				matrix.compose(position, rotation, scale);
				smokeMesh.setMatrixAt(index, matrix);
				const shade = 0.26 + progress * 0.38;
				smokeMesh.setColorAt(index, color.setRGB(shade, shade, shade * 0.95));
			}
			smokeMesh.instanceMatrix.needsUpdate = true;
			if (smokeMesh.instanceColor) smokeMesh.instanceColor.needsUpdate = true;
			smokeMesh.visible = smokeActive;
			return trailsActive || smokeActive;
		},
		destroy() {
			scene.remove(trailMesh, smokeMesh);
			trailGeometry.dispose();
			smokeGeometry.dispose();
			(trailMesh.material as THREE.Material).dispose();
			(smokeMesh.material as THREE.Material).dispose();
		},
	};
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
	collision?: CollisionQuery,
	terrain?: TerrainQuery,
	onModelReady?: () => void,
): TrafficView {
	const simulation = createTrafficSimulation({ layout, seed, maxVehicles, collision, terrain });
	if (simulation.vehicles.length === 0) {
		return {
			step: () => undefined,
			resolvePlayerImpacts: () => [],
			render: () => false,
			destroy: () => undefined,
		};
	}
	const assets = createSharedAssets(simulation.vehicles);
	const visuals = simulation.vehicles.map((state) => addTrafficVehicle(scene, assets, state));
	const tireEffects = addTrafficTireEffects(scene);
	let destroyed = false;
	let visualDeltaSeconds = 0;

	void loadTrafficModels()
		.then((models) => {
			if (destroyed) return;
			for (let index = 0; index < visuals.length; index += 1) {
				const visual = visuals[index];
				const packed = models.get(simulation.vehicles[index].modelId);
				const material = assets.bodyMaterials.get(visual.model.id);
				if (packed && material) attachPackedModel(visual, packed, material);
			}
			onModelReady?.();
		})
		.catch((error: unknown) => {
			console.warn('Traffic source models could not load; using lightweight fallback.', error);
		});

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
			const response = 1 - Math.exp(-8 * renderDeltaSeconds);
			const effectSources: TireEffectSource[] = [];
			let effectsActive = false;
			for (let index = 0; index < simulation.vehicles.length; index += 1) {
				const state = simulation.vehicles[index];
				const visual = visuals[index];
				const relativeX = wrappedDelta(state.x - player.x, layout.worldSpan);
				const relativeZ = wrappedDelta(state.z - player.z, layout.worldSpan);
				const visible = relativeX * relativeX + relativeZ * relativeZ < TRAFFIC_RENDER_DISTANCE ** 2;
				visual.group.visible = visible;
				if (!visible) continue;
				const renderX = player.x + relativeX;
				const renderZ = player.z + relativeZ;
				visual.group.position.set(renderX, 0.04, renderZ);
				visual.group.rotation.y = state.heading;
				const accelerationStretch = Math.max(0, state.longitudinalLoad);
				const brakingSquash = Math.max(0, -state.longitudinalLoad);
				const damage = THREE.MathUtils.clamp(state.damage, 0, 1);
				visual.motion.position.y = THREE.MathUtils.lerp(
					visual.motion.position.y,
					state.verticalOffset,
					response,
				);
				visual.motion.rotation.x = THREE.MathUtils.lerp(
					visual.motion.rotation.x,
					state.crashPitch,
					response,
				);
				visual.motion.rotation.y = THREE.MathUtils.lerp(
					visual.motion.rotation.y,
					state.crashYaw,
					response,
				);
				visual.motion.rotation.z = THREE.MathUtils.lerp(
					visual.motion.rotation.z,
					state.crashRoll,
					response,
				);
				visual.chassis.rotation.x = THREE.MathUtils.lerp(
					visual.chassis.rotation.x,
					-state.longitudinalLoad * 0.07 - state.impactIntensity * 0.045 - damage * 0.02,
					response,
				);
				visual.chassis.rotation.z = THREE.MathUtils.lerp(
					visual.chassis.rotation.z,
					state.lateralLoad * 0.08 + damage * 0.025,
					response,
				);
				visual.chassis.scale.y = THREE.MathUtils.lerp(
					visual.chassis.scale.y,
					1 - accelerationStretch * 0.025 - brakingSquash * 0.08 - state.impactIntensity * 0.05 - damage * 0.06,
					response,
				);
				visual.chassis.scale.z = THREE.MathUtils.lerp(
					visual.chassis.scale.z,
					1 + accelerationStretch * 0.05 + state.impactIntensity * 0.07 + damage * 0.035,
					response,
				);
				for (const pivot of visual.frontAxle.pivots) {
					pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, state.steeringAngle, response);
				}
				const forwardSpeed =
					state.velocityX * Math.sin(state.heading) + state.velocityZ * Math.cos(state.heading);
				for (const wheel of visual.frontAxle.wheels) {
					wheel.rotation.x -= forwardSpeed * TRAFFIC_WHEEL_SPIN_FACTOR * renderDeltaSeconds;
				}
				const rearWheelSpeed = forwardSpeed + state.rearSlip * 6 * Math.sign(forwardSpeed || 1);
				for (const wheel of visual.rearAxle.wheels) {
					wheel.rotation.x -= rearWheelSpeed * TRAFFIC_WHEEL_SPIN_FACTOR * renderDeltaSeconds;
				}
				effectSources.push({ state, model: visual.model, x: renderX, z: renderZ });
				effectsActive ||=
					state.verticalOffset > 0 || state.impactIntensity > 0 || hasVehicleCrashMotion(state);
			}
			effectsActive ||= tireEffects.update(renderDeltaSeconds, effectSources);
			return effectsActive;
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			for (const visual of visuals) scene.remove(visual.group);
			tireEffects.destroy();
			assets.unitBox.dispose();
			assets.unitWheel.dispose();
			assets.shadowGeometry.dispose();
			for (const material of assets.bodyMaterials.values()) material.dispose();
			assets.fallbackGlass.dispose();
			assets.tire.dispose();
			assets.shadow.dispose();
		},
	};
}
