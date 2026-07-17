import * as THREE from 'three';

import type { VehicleState } from './vehicle';

interface CarVisual {
	group: THREE.Group;
	chassis: THREE.Group;
	frontWheelPivots: THREE.Group[];
	frontWheels: THREE.Mesh[];
	rearWheels: THREE.Mesh[];
}

function addCar(scene: THREE.Scene): CarVisual {
	const group = new THREE.Group();
	const chassis = new THREE.Group();
	group.add(chassis);
	const red = new THREE.MeshLambertMaterial({ color: 0xd9523f });
	const cream = new THREE.MeshLambertMaterial({ color: 0xf5d99d });
	const glass = new THREE.MeshLambertMaterial({ color: 0x8fc5c2 });
	const dark = new THREE.MeshLambertMaterial({ color: 0x30343b });
	const light = new THREE.MeshBasicMaterial({ color: 0xffefaa });

	const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.65, 4.3), red);
	body.position.y = 0.85;
	chassis.add(body);

	const hood = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.34, 1.35), cream);
	hood.position.set(0, 1.26, 1.12);
	chassis.add(hood);

	const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.92, 1.75), glass);
	cabin.position.set(0, 1.58, -0.46);
	chassis.add(cabin);

	const roof = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.18, 1.92), cream);
	roof.position.set(0, 2.1, -0.46);
	chassis.add(roof);

	const wheelGeometry = new THREE.CylinderGeometry(0.48, 0.48, 0.36, 8);
	wheelGeometry.rotateZ(Math.PI / 2);
	const frontWheelPivots: THREE.Group[] = [];
	const frontWheels: THREE.Mesh[] = [];
	const rearWheels: THREE.Mesh[] = [];
	for (const x of [-1.36, 1.36]) {
		for (const z of [-1.32, 1.32]) {
			const pivot = new THREE.Group();
			pivot.position.set(x, 0.56, z);
			const wheel = new THREE.Mesh(wheelGeometry, dark);
			pivot.add(wheel);
			group.add(pivot);
			if (z > 0) {
				frontWheelPivots.push(pivot);
				frontWheels.push(wheel);
			} else {
				rearWheels.push(wheel);
			}
		}
	}

	for (const x of [-0.78, 0.78]) {
		const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.08), light);
		headlight.position.set(x, 0.95, 2.18);
		chassis.add(headlight);
	}

	const shadow = new THREE.Mesh(
		new THREE.CircleGeometry(2.25, 18),
		new THREE.MeshBasicMaterial({ color: 0x24372d, transparent: true, opacity: 0.22, depthWrite: false }),
	);
	shadow.rotation.x = -Math.PI / 2;
	shadow.position.y = 0.06;
	shadow.scale.y = 0.72;
	group.add(shadow);

	group.position.y = 0.06;
	scene.add(group);
	return { group, chassis, frontWheelPivots, frontWheels, rearWheels };
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

interface TireEffects {
	update(deltaSeconds: number, state: VehicleState): boolean;
}

const TRAIL_POOL_SIZE = 48;
const SMOKE_POOL_SIZE = 24;

function addTireEffects(scene: THREE.Scene): TireEffects {
	const trailGeometry = new THREE.PlaneGeometry(1, 1);
	trailGeometry.rotateX(-Math.PI / 2);
	const trailMesh = new THREE.InstancedMesh(
		trailGeometry,
		new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.3,
			depthWrite: false,
			vertexColors: true,
		}),
		TRAIL_POOL_SIZE,
	);
	trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	trailMesh.frustumCulled = false;
	trailMesh.renderOrder = 1;
	trailMesh.visible = false;
	scene.add(trailMesh);

	const smokeMesh = new THREE.InstancedMesh(
		new THREE.DodecahedronGeometry(0.35, 0),
		new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.24,
			depthWrite: false,
			vertexColors: true,
		}),
		SMOKE_POOL_SIZE,
	);
	smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	smokeMesh.frustumCulled = false;
	smokeMesh.renderOrder = 2;
	smokeMesh.visible = false;
	scene.add(smokeMesh);

	const trails: TrailMark[] = Array.from({ length: TRAIL_POOL_SIZE }, () => ({
		active: false,
		age: 0,
		lifetime: 0,
		x: 0,
		z: 0,
		heading: 0,
		intensity: 0,
		length: 0,
	}));
	const smoke: SmokePuff[] = Array.from({ length: SMOKE_POOL_SIZE }, () => ({
		active: false,
		age: 0,
		lifetime: 0,
		x: 0,
		y: 0,
		z: 0,
		driftX: 0,
		driftZ: 0,
		size: 0,
	}));
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const rotation = new THREE.Quaternion();
	const euler = new THREE.Euler();
	const scale = new THREE.Vector3();
	const color = new THREE.Color();
	const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
	let trailCursor = 0;
	let smokeCursor = 0;
	let trailElapsed = 0;
	let smokeElapsed = 0;

	for (let index = 0; index < TRAIL_POOL_SIZE; index += 1) {
		trailMesh.setMatrixAt(index, hiddenMatrix);
		trailMesh.setColorAt(index, color.setRGB(0.16, 0.18, 0.17));
	}
	for (let index = 0; index < SMOKE_POOL_SIZE; index += 1) {
		smokeMesh.setMatrixAt(index, hiddenMatrix);
		smokeMesh.setColorAt(index, color.setRGB(0.25, 0.27, 0.26));
	}

	function rearWheelPosition(state: VehicleState, localX: number) {
		const localZ = -1.35;
		return {
			x: state.x + Math.cos(state.heading) * localX + Math.sin(state.heading) * localZ,
			z: state.z - Math.sin(state.heading) * localX + Math.cos(state.heading) * localZ,
		};
	}

	function emitTrailPair(state: VehicleState, intensity: number): void {
		for (const localX of [-1.02, 1.02]) {
			const wheelPosition = rearWheelPosition(state, localX);
			const mark = trails[trailCursor];
			trailCursor = (trailCursor + 1) % TRAIL_POOL_SIZE;
			mark.active = true;
			mark.age = 0;
			mark.lifetime = 2.4 + intensity * 2.4;
			mark.x = wheelPosition.x;
			mark.z = wheelPosition.z;
			mark.heading = state.heading;
			mark.intensity = intensity;
			mark.length = 0.42 + Math.min(Math.abs(state.speed) * 0.035, 0.72);
		}
	}

	function emitSmokePair(state: VehicleState, intensity: number): void {
		for (const localX of [-1.02, 1.02]) {
			const wheelPosition = rearWheelPosition(state, localX);
			const puff = smoke[smokeCursor];
			const phase = smokeCursor * 2.37;
			smokeCursor = (smokeCursor + 1) % SMOKE_POOL_SIZE;
			puff.active = true;
			puff.age = 0;
			puff.lifetime = 0.7 + intensity * 0.45;
			puff.x = wheelPosition.x;
			puff.y = 0.42;
			puff.z = wheelPosition.z;
			puff.driftX = Math.sin(phase) * 0.24;
			puff.driftZ = Math.cos(phase) * 0.24;
			puff.size = 0.65 + intensity * 0.55;
		}
	}

	return {
		update(deltaSeconds, state) {
			trailElapsed += deltaSeconds;
			smokeElapsed += deltaSeconds;
			const rollingTrail = Math.abs(state.speed) > 4 ? 0.1 : 0;
			const trailIntensity = Math.max(rollingTrail, state.skidIntensity);
			const trailInterval = state.skidIntensity > 0.2 ? 0.045 : 0.11;
			if (trailIntensity > 0 && trailElapsed >= trailInterval) {
				trailElapsed = 0;
				emitTrailPair(state, trailIntensity);
			}

			const smokeIntensity = Math.max(state.rearSlip, state.skidIntensity - 0.25);
			if (smokeIntensity > 0.28 && smokeElapsed >= 0.075) {
				smokeElapsed = 0;
				emitSmokePair(state, smokeIntensity);
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

				position.set(mark.x, 0.15, mark.z);
				rotation.setFromEuler(euler.set(0, mark.heading, 0));
				scale.set((0.12 + mark.intensity * 0.12) * fade, 1, mark.length);
				matrix.compose(position, rotation, scale);
				trailMesh.setMatrixAt(index, matrix);
				const shade = 0.16 + (1 - fade) * 0.34;
				trailMesh.setColorAt(index, color.setRGB(shade, shade * 1.06, shade));
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
				puff.y += 0.62 * deltaSeconds;
				puff.z += puff.driftZ * deltaSeconds;
				const puffScale = puff.size * (0.55 + progress) * Math.min(1, fade * 3);
				position.set(puff.x, puff.y, puff.z);
				rotation.identity();
				scale.setScalar(puffScale);
				matrix.compose(position, rotation, scale);
				smokeMesh.setMatrixAt(index, matrix);
				const shade = 0.27 + progress * 0.42;
				smokeMesh.setColorAt(index, color.setRGB(shade, shade, shade * 0.96));
			}
			smokeMesh.instanceMatrix.needsUpdate = true;
			if (smokeMesh.instanceColor) smokeMesh.instanceColor.needsUpdate = true;
			smokeMesh.visible = smokeActive;
			return trailsActive || smokeActive;
		},
	};
}

export interface VehicleView {
	update(deltaSeconds: number, state: VehicleState): boolean;
}

export function addVehicleView(scene: THREE.Scene): VehicleView {
	const car = addCar(scene);
	const tireEffects = addTireEffects(scene);

	return {
		update(delta, state) {
		car.group.position.x = state.x;
		car.group.position.z = state.z;
		car.group.rotation.y = state.heading;
		const visualResponse = 1 - Math.exp(-delta * 11);
		const accelerationStretch = Math.max(0, state.longitudinalLoad);
		const brakingSquash = Math.max(0, -state.longitudinalLoad);
		car.chassis.rotation.x = THREE.MathUtils.lerp(
			car.chassis.rotation.x,
			-state.longitudinalLoad * 0.075,
			visualResponse,
		);
		car.chassis.rotation.z = THREE.MathUtils.lerp(
			car.chassis.rotation.z,
			state.lateralLoad * 0.09,
			visualResponse,
		);
		car.chassis.scale.x = THREE.MathUtils.lerp(
			car.chassis.scale.x,
			1 + brakingSquash * 0.045,
			visualResponse,
		);
		car.chassis.scale.y = THREE.MathUtils.lerp(
			car.chassis.scale.y,
			1 - accelerationStretch * 0.025 - brakingSquash * 0.09,
			visualResponse,
		);
		car.chassis.scale.z = THREE.MathUtils.lerp(
			car.chassis.scale.z,
			1 + accelerationStretch * 0.055,
			visualResponse,
		);
		for (const pivot of car.frontWheelPivots) {
			pivot.rotation.y = THREE.MathUtils.lerp(
				pivot.rotation.y,
				state.steeringAngle,
				visualResponse,
			);
		}
		for (const wheel of car.frontWheels) wheel.rotation.x -= state.speed * delta * 0.75;
		const rearWheelSpeed = state.speed + state.rearSlip * 8 * Math.sign(state.speed || 1);
		for (const wheel of car.rearWheels) wheel.rotation.x -= rearWheelSpeed * delta * 0.75;
		const effectsActive = tireEffects.update(delta, state);
		return effectsActive;
		},
	};
}
