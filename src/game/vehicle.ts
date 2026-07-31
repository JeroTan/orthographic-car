import {
	clampVelocityMagnitude,
	type VehicleImpactBody,
	type VehicleImpactEffect,
} from './vehicle-impact';
import {
	applyVehicleCrashImpulse,
	createVehicleCrashState,
	stepVehicleCrashState,
	type VehicleCrashState,
} from './vehicle-crash';
import {
	stepVehicleMotion,
	type VehicleMotionInstruction,
	type VehicleMotionProfile,
} from './vehicle-motion';

export type { VehicleImpactEffect } from './vehicle-impact';

export interface VehicleInput {
	accelerate: boolean;
	brake: boolean;
	left: boolean;
	right: boolean;
	handbrake?: boolean;
}

export interface VehicleState extends VehicleCrashState {
	x: number;
	z: number;
	heading: number;
	speed: number;
	slipAngle: number;
	longitudinalLoad: number;
	steeringAngle: number;
	lateralLoad: number;
	rearSlip: number;
	skidIntensity: number;
	verticalOffset: number;
	verticalVelocity: number;
	impactIntensity: number;
	damage: number;
}

export interface VehicleController {
	readonly state: VehicleState;
	step(deltaSeconds: number, input: VehicleInput): void;
	unstick(): boolean;
	getCollisionBody(): VehicleImpactBody;
	applyImpact(impact: VehicleImpactEffect): void;
}

export interface CollisionQuery {
	intersectsCircle(x: number, z: number, radius: number): boolean;
	normalAt?(x: number, z: number, radius: number): { x: number; z: number } | undefined;
}

export interface TerrainQuery {
	surfaceAt(x: number, z: number): 'road' | 'meadow';
	grassDensityAt?(x: number, z: number): number;
}

interface VehicleConfig {
	worldSpan: number;
	collision?: CollisionQuery;
	terrain?: TerrainQuery;
}

/** Porsche 911 GT2 (997) dimensions from Porsche technical data. */
export const PORSCHE_DIMENSIONS_METERS = Object.freeze({
	length: 4.469,
	width: 1.852,
});

/** Packed asset dimensions after MODEL_SCALE in porsche-model.ts. */
export const PORSCHE_MODEL_DIMENSIONS_WORLD = Object.freeze({
	length: 4.908842,
	width: 2.156494,
});

/** Physical metres represented by one packed-model world unit on each axis. */
export const PORSCHE_METERS_PER_WORLD_UNIT = Object.freeze({
	length: PORSCHE_DIMENSIONS_METERS.length / PORSCHE_MODEL_DIMENSIONS_WORLD.length,
	width: PORSCHE_DIMENSIONS_METERS.width / PORSCHE_MODEL_DIMENSIONS_WORLD.width,
});

/** Longitudinal world scale. Width scale feeds the collision footprint below. */
export const WORLD_METERS_PER_UNIT = PORSCHE_METERS_PER_WORLD_UNIT.length;
export const WORLD_SPEED_TO_KMH = WORLD_METERS_PER_UNIT * 3.6;
const WORLD_UNITS_PER_METER = 1 / WORLD_METERS_PER_UNIT;

const ROAD_ACCELERATION_MPS2 = 7.73;
const MEADOW_ACCELERATION_MPS2 = 4.74;
const BRAKING_MPS2 = 13.68;
const REVERSE_ACCELERATION_MPS2 = 6.83;
const MEADOW_REVERSE_ACCELERATION_MPS2 = 4.39;
const COAST_DRAG_MPS2 = 8.43;
const GRASS_ROLLING_DRAG_MPS2 = 3.86;
const TURNING_DRAG_MPS2 = 14.06;
const HANDBRAKE_DRAG_MPS2 = 21.08;
const IMPACT_GRAVITY_MPS2 = 22;

function worldSpeedFromKmh(speedKmh: number): number {
	return speedKmh / WORLD_SPEED_TO_KMH;
}

function worldAccelerationFromMps2(accelerationMps2: number): number {
	return accelerationMps2 * WORLD_UNITS_PER_METER;
}

const ACCELERATION = worldAccelerationFromMps2(ROAD_ACCELERATION_MPS2);
const MEADOW_ACCELERATION = worldAccelerationFromMps2(MEADOW_ACCELERATION_MPS2);
const BRAKING = worldAccelerationFromMps2(BRAKING_MPS2);
const REVERSE_ACCELERATION = worldAccelerationFromMps2(REVERSE_ACCELERATION_MPS2);
const MEADOW_REVERSE_ACCELERATION = worldAccelerationFromMps2(MEADOW_REVERSE_ACCELERATION_MPS2);
const COAST_DRAG = worldAccelerationFromMps2(COAST_DRAG_MPS2);
const MAX_SPEED = worldSpeedFromKmh(329);
const MAX_MEADOW_SPEED = worldSpeedFromKmh(177);
const GRASS_ROLLING_DRAG = worldAccelerationFromMps2(GRASS_ROLLING_DRAG_MPS2);
const GRASS_SPEED_DRAG = 0.12;
const MAX_REVERSE_SPEED = worldSpeedFromKmh(152);
const MAX_MEADOW_REVERSE_SPEED = worldSpeedFromKmh(89);
const MAX_STEERING_ANGLE = 0.5;
const STEERING_RESPONSE = 4.5;
const TURNING_DRAG = worldAccelerationFromMps2(TURNING_DRAG_MPS2);
const HANDBRAKE_DRAG = worldAccelerationFromMps2(HANDBRAKE_DRAG_MPS2);
const IMPACT_GRAVITY = worldAccelerationFromMps2(IMPACT_GRAVITY_MPS2);
const BRAKING_YAW_BOOST = 3.2;
const HANDBRAKE_YAW_BOOST = 5;
const ROAD_GRIP = 10;
const BRAKING_REAR_GRIP = 4.5;
const HANDBRAKE_REAR_GRIP = 1.2;
const CAR_COLLISION_RADIUS =
	(PORSCHE_DIMENSIONS_METERS.width / WORLD_METERS_PER_UNIT) / 2 + 0.2;
const CAR_COLLISION_OFFSET = Math.max(
	0,
	PORSCHE_MODEL_DIMENSIONS_WORLD.length / 2 - CAR_COLLISION_RADIUS,
);
const COLLISION_SAMPLE_DISTANCE = CAR_COLLISION_RADIUS;
const MAX_COLLISION_SAMPLES = 6;
const SPEED_ACCELERATION_TAPER = 0.8;
const SPEED_ACCELERATION_CURVE = 1.6;
const PORSCHE_WHEELBASE = 2.35 * WORLD_UNITS_PER_METER;
const MAX_LATERAL_ACCELERATION = worldAccelerationFromMps2(8.8);
const LAUNCH_SLIP_SPEED = worldSpeedFromKmh(75.9);
const HARD_BRAKING_SPEED = worldSpeedFromKmh(101.2);
const LATERAL_LOAD_SPEED = worldSpeedFromKmh(404.8);
const PLAYER_COLLISION_RADIUS = CAR_COLLISION_RADIUS;
const PLAYER_COLLISION_MASS = 1.55;
const IMPACT_VELOCITY_DAMPING = 4.6;
const IMPACT_INTENSITY_DECAY = 1.7;
const IMPACT_GROUND_RESTITUTION = 0.28;
const IMPACT_GROUND_STOP_SPEED = worldAccelerationFromMps2(0.8);
const MAX_IMPACT_VERTICAL_SPEED = worldAccelerationFromMps2(9.5);
const MAX_IMPACT_KNOCKBACK_SPEED = worldSpeedFromKmh(145);
const IMPACT_AIR_VELOCITY_DAMPING = 0.35;
const STATIC_COLLISION_RESTITUTION = 0.34;
const STATIC_COLLISION_DAMAGE_SPEED = worldSpeedFromKmh(24);
const STATIC_COLLISION_LAUNCH_SPEED = worldSpeedFromKmh(58);
const STATIC_COLLISION_LAUNCH_FACTOR = 0.18;
const UNSTUCK_SEARCH_STEP = 0.5;
const UNSTUCK_SEARCH_MAX_DISTANCE = 12;
const UNSTUCK_SEARCH_DIRECTIONS = 12;
const AIRBORNE_INPUT: VehicleInput = {
	accelerate: false,
	brake: false,
	left: false,
	right: false,
	handbrake: false,
};

export function toSpeedometerKmh(longitudinalSpeed: number): number {
	return Math.round(Math.abs(longitudinalSpeed) * WORLD_SPEED_TO_KMH);
}

export function toWorldSpeed(speedKmh: number): number {
	return worldSpeedFromKmh(speedKmh);
}

const SURFACE_HANDLING = {
	road: {
		acceleration: ACCELERATION,
		maxForwardSpeed: MAX_SPEED,
		reverseAcceleration: REVERSE_ACCELERATION,
		maxReverseSpeed: MAX_REVERSE_SPEED,
	},
	meadow: {
		acceleration: MEADOW_ACCELERATION,
		maxForwardSpeed: MAX_MEADOW_SPEED,
		reverseAcceleration: MEADOW_REVERSE_ACCELERATION,
		maxReverseSpeed: MAX_MEADOW_REVERSE_SPEED,
	},
} as const;

type SurfaceHandling = (typeof SURFACE_HANDLING)[keyof typeof SURFACE_HANDLING];

function wrapCoordinate(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function coastTowardStop(speed: number, amount: number): number {
	if (speed > 0) return Math.max(0, speed - amount);
	if (speed < 0) return Math.min(0, speed + amount);
	return 0;
}

function motionInstruction(input: VehicleInput, speed: number): VehicleMotionInstruction {
	if (input.accelerate === input.brake) {
		return {
			drive: 0,
			brake: 0,
			steering: Number(input.left) - Number(input.right),
			handbrake: input.handbrake,
		};
	}
	if (input.accelerate) {
		return {
			drive: speed >= 0 ? 1 : 0,
			brake: speed < 0 ? 1 : 0,
			steering: Number(input.left) - Number(input.right),
			handbrake: input.handbrake,
		};
	}
	return {
		drive: speed <= 0 ? -1 : 0,
		brake: speed > 0 ? 1 : 0,
		steering: Number(input.left) - Number(input.right),
		handbrake: input.handbrake,
	};
}

function motionProfile(handling: SurfaceHandling): VehicleMotionProfile {
	return {
		maxForwardSpeed: handling.maxForwardSpeed,
		maxReverseSpeed: handling.maxReverseSpeed,
		acceleration: handling.acceleration,
		reverseAcceleration: handling.reverseAcceleration,
		braking: BRAKING,
		coastDrag: COAST_DRAG,
		turningDrag: TURNING_DRAG,
		wheelbase: PORSCHE_WHEELBASE,
		maxSteeringAngle: MAX_STEERING_ANGLE,
		steeringResponse: STEERING_RESPONSE,
		maxLateralAcceleration: MAX_LATERAL_ACCELERATION,
		accelerationTaper: SPEED_ACCELERATION_TAPER,
		accelerationCurve: SPEED_ACCELERATION_CURVE,
		brakingYawBoost: BRAKING_YAW_BOOST,
		handbrakeDrag: HANDBRAKE_DRAG,
		handbrakeYawBoost: HANDBRAKE_YAW_BOOST,
	};
}

function updatePhysicsFeedback(
	state: VehicleState,
	deltaSeconds: number,
	input: VehicleInput,
	previousSpeed: number,
	previousHeading: number,
	launchSlip: number,
): void {
	state.longitudinalLoad =
		deltaSeconds > 0
			? Math.max(-1, Math.min(1, (state.speed - previousSpeed) / (BRAKING * deltaSeconds)))
			: 0;
	state.lateralLoad =
		deltaSeconds > 0
			? Math.max(
					-1,
					Math.min(
						1,
						((state.heading - previousHeading) / deltaSeconds) *
							(Math.abs(state.speed) / LATERAL_LOAD_SPEED),
					),
				)
			: 0;
	const driftSlip = input.handbrake ? Math.min(1, Math.abs(state.slipAngle) * 3) : 0;
	state.rearSlip = Math.max(0, launchSlip, driftSlip);
	const brakeSkid = input.brake && previousSpeed > 8 ? Math.max(0, -state.longitudinalLoad) : 0;
	const driftSkid = input.handbrake
		? Math.min(1, Math.abs(state.slipAngle) * 4 + Math.abs(state.lateralLoad) * 0.5)
		: 0;
	state.skidIntensity = Math.max(brakeSkid, driftSkid);
}

function collisionPointAt(
	collision: CollisionQuery,
	x: number,
	z: number,
	heading: number,
): { x: number; z: number } | undefined {
	const offsetX = Math.sin(heading) * CAR_COLLISION_OFFSET;
	const offsetZ = Math.cos(heading) * CAR_COLLISION_OFFSET;
	const front = { x: x + offsetX, z: z + offsetZ };
	if (collision.intersectsCircle(front.x, front.z, CAR_COLLISION_RADIUS)) return front;
	const rear = { x: x - offsetX, z: z - offsetZ };
	return collision.intersectsCircle(rear.x, rear.z, CAR_COLLISION_RADIUS) ? rear : undefined;
}

function collidesAlongPath(
	collision: CollisionQuery,
	startX: number,
	startZ: number,
	endX: number,
	endZ: number,
	heading: number,
	worldSpan: number,
): { x: number; z: number } | undefined {
	const rawDeltaX = endX - startX;
	const rawDeltaZ = endZ - startZ;
	const deltaX =
		Math.abs(rawDeltaX) > worldSpan / 2
			? rawDeltaX - Math.sign(rawDeltaX) * worldSpan
			: rawDeltaX;
	const deltaZ =
		Math.abs(rawDeltaZ) > worldSpan / 2
			? rawDeltaZ - Math.sign(rawDeltaZ) * worldSpan
			: rawDeltaZ;
	const travelDistance = Math.hypot(deltaX, deltaZ);
	const sampleCount = Math.min(
		MAX_COLLISION_SAMPLES,
		Math.max(1, Math.ceil(travelDistance / COLLISION_SAMPLE_DISTANCE)),
	);

	for (let sample = 1; sample <= sampleCount; sample += 1) {
		const progress = sample / sampleCount;
		const point = collisionPointAt(
			collision,
			wrapCoordinate(startX + deltaX * progress, worldSpan),
			wrapCoordinate(startZ + deltaZ * progress, worldSpan),
			heading,
		);
		if (point) return point;
	}

	return undefined;
}

function collisionNormal(
	collision: CollisionQuery,
	contact: { x: number; z: number },
	velocityX: number,
	velocityZ: number,
	heading: number,
): { x: number; z: number } {
	const candidate = collision.normalAt?.(contact.x, contact.z, CAR_COLLISION_RADIUS);
	const candidateLength = candidate ? Math.hypot(candidate.x, candidate.z) : 0;
	if (candidate && Number.isFinite(candidateLength) && candidateLength > 0.0001) {
		return { x: candidate.x / candidateLength, z: candidate.z / candidateLength };
	}

	const velocityLength = Math.hypot(velocityX, velocityZ);
	if (velocityLength > 0.0001) return { x: -velocityX / velocityLength, z: -velocityZ / velocityLength };
	return { x: -Math.sin(heading), z: -Math.cos(heading) };
}

function findCollisionEscape(
	collision: CollisionQuery,
	x: number,
	z: number,
	heading: number,
	worldSpan: number,
): { x: number; z: number } | undefined {
	const contact = collisionPointAt(collision, x, z, heading);
	if (!contact) return undefined;
	const normal = collisionNormal(collision, contact, 0, 0, heading);
	const normalAngle = Math.atan2(normal.x, normal.z);

	for (
		let distance = UNSTUCK_SEARCH_STEP;
		distance <= UNSTUCK_SEARCH_MAX_DISTANCE;
		distance += UNSTUCK_SEARCH_STEP
	) {
		for (let direction = 0; direction < UNSTUCK_SEARCH_DIRECTIONS; direction += 1) {
			const angle = normalAngle + (direction * Math.PI * 2) / UNSTUCK_SEARCH_DIRECTIONS;
			const candidate = {
				x: wrapCoordinate(x + Math.sin(angle) * distance, worldSpan),
				z: wrapCoordinate(z + Math.cos(angle) * distance, worldSpan),
			};
			if (!collisionPointAt(collision, candidate.x, candidate.z, heading)) return candidate;
		}
	}

	return undefined;
}

export function createVehicleController(config: VehicleConfig): VehicleController {
	const state: VehicleState = {
		x: 0,
		z: 0,
		heading: 0,
		speed: 0,
		slipAngle: 0,
		longitudinalLoad: 0,
		steeringAngle: 0,
		lateralLoad: 0,
		rearSlip: 0,
		skidIntensity: 0,
		verticalOffset: 0,
		verticalVelocity: 0,
		impactIntensity: 0,
		damage: 0,
		...createVehicleCrashState(),
	};
	let velocityX = 0;
	let velocityZ = 0;
	let impactVelocityX = 0;
	let impactVelocityZ = 0;

	function unstick(): boolean {
		if (!config.collision) return false;
		const escape = findCollisionEscape(
			config.collision,
			state.x,
			state.z,
			state.heading,
			config.worldSpan,
		);
		if (!escape) return false;

		state.x = escape.x;
		state.z = escape.z;
		state.speed = 0;
		state.slipAngle = 0;
		velocityX = 0;
		velocityZ = 0;
		impactVelocityX = 0;
		impactVelocityZ = 0;
		return true;
	}

	return {
		state,
		step(deltaSeconds, input) {
			const previousSpeed = state.speed;
			const previousHeading = state.heading;
			const airborne = state.verticalOffset > 0 || state.verticalVelocity > 0;
			state.impactIntensity = Math.max(
				0,
				state.impactIntensity - IMPACT_INTENSITY_DECAY * deltaSeconds,
			);
			if (airborne) {
				state.verticalVelocity -= IMPACT_GRAVITY * deltaSeconds;
				state.verticalOffset += state.verticalVelocity * deltaSeconds;
				if (state.verticalOffset <= 0) {
					state.verticalOffset = 0;
					const rebound = -state.verticalVelocity * IMPACT_GROUND_RESTITUTION;
					state.verticalVelocity = rebound > IMPACT_GROUND_STOP_SPEED ? rebound : 0;
				}
			}
			stepVehicleCrashState(state, deltaSeconds, airborne);
			if (!airborne) unstick();
			const controlInput = airborne ? AIRBORNE_INPUT : input;
			const surface = config.terrain?.surfaceAt(state.x, state.z) ?? 'road';
			const handling = SURFACE_HANDLING[surface];
			stepVehicleMotion(
				state,
				motionInstruction(controlInput, state.speed),
				motionProfile(handling),
				deltaSeconds,
			);
			const grassDensity = Math.max(
				0,
				Math.min(1, config.terrain?.grassDensityAt?.(state.x, state.z) ?? 0),
			);
			state.speed = coastTowardStop(
				state.speed,
				grassDensity *
					(GRASS_ROLLING_DRAG + Math.abs(state.speed) * GRASS_SPEED_DRAG) *
					deltaSeconds,
			);

			const forwardX = Math.sin(state.heading);
			const forwardZ = Math.cos(state.heading);
			const rightX = Math.cos(state.heading);
			const rightZ = -Math.sin(state.heading);
			const launchSlip =
				controlInput.accelerate &&
				!controlInput.brake &&
				previousSpeed >= 0 &&
				state.speed < LAUNCH_SLIP_SPEED
					? 1 - state.speed / LAUNCH_SLIP_SPEED
					: 0;
			const lateralVelocity = velocityX * rightX + velocityZ * rightZ;
			const poweredRearGrip = ROAD_GRIP * (1 - launchSlip * 0.45);
			const hardBraking =
				controlInput.brake && !controlInput.accelerate && previousSpeed > HARD_BRAKING_SPEED;
			const grip = controlInput.handbrake
				? HANDBRAKE_REAR_GRIP
				: hardBraking
					? BRAKING_REAR_GRIP
					: poweredRearGrip;
			const retainedLateralVelocity = lateralVelocity * Math.max(0, 1 - grip * deltaSeconds);
			velocityX = forwardX * state.speed + rightX * retainedLateralVelocity;
			velocityZ = forwardZ * state.speed + rightZ * retainedLateralVelocity;
			const impactDamping = Math.exp(
				-(airborne ? IMPACT_AIR_VELOCITY_DAMPING : IMPACT_VELOCITY_DAMPING) * deltaSeconds,
			);
			impactVelocityX *= impactDamping;
			impactVelocityZ *= impactDamping;
			state.slipAngle = Math.atan2(retainedLateralVelocity, Math.max(Math.abs(state.speed), 0.01));

			const nextX = wrapCoordinate(
				state.x + (velocityX + impactVelocityX) * deltaSeconds,
				config.worldSpan,
			);
			const nextZ = wrapCoordinate(
				state.z + (velocityZ + impactVelocityZ) * deltaSeconds,
				config.worldSpan,
			);

			const collisionContact =
				config.collision && !airborne
					? collidesAlongPath(
							config.collision,
							state.x,
							state.z,
							nextX,
							nextZ,
							state.heading,
							config.worldSpan,
						)
					: undefined;

			if (collisionContact && config.collision) {
				const travelVelocityX = velocityX + impactVelocityX;
				const travelVelocityZ = velocityZ + impactVelocityZ;
				const normal = collisionNormal(
					config.collision,
					collisionContact,
					travelVelocityX,
					travelVelocityZ,
					state.heading,
				);
				const inwardSpeed = Math.max(
					0,
					-(travelVelocityX * normal.x + travelVelocityZ * normal.z),
				);

				if (inwardSpeed > 0) {
					const reflectedVelocityX =
						travelVelocityX + normal.x * inwardSpeed * (1 + STATIC_COLLISION_RESTITUTION);
					const reflectedVelocityZ =
						travelVelocityZ + normal.z * inwardSpeed * (1 + STATIC_COLLISION_RESTITUTION);
					const forwardX = Math.sin(state.heading);
					const forwardZ = Math.cos(state.heading);
					const reflectedSpeed = Math.max(
						-MAX_REVERSE_SPEED,
						Math.min(
							MAX_SPEED,
							reflectedVelocityX * forwardX + reflectedVelocityZ * forwardZ,
						),
					);
					const residualVelocity = clampVelocityMagnitude(
						reflectedVelocityX - forwardX * reflectedSpeed,
						reflectedVelocityZ - forwardZ * reflectedSpeed,
						MAX_IMPACT_KNOCKBACK_SPEED,
					);
					const intensity = Math.max(
						0,
						Math.min(1, inwardSpeed / STATIC_COLLISION_LAUNCH_SPEED),
					);
					const verticalVelocity = Math.min(
						MAX_IMPACT_VERTICAL_SPEED,
						Math.max(0, inwardSpeed - STATIC_COLLISION_LAUNCH_SPEED) *
							STATIC_COLLISION_LAUNCH_FACTOR,
					);

					state.speed = reflectedSpeed;
					velocityX = forwardX * reflectedSpeed;
					velocityZ = forwardZ * reflectedSpeed;
					impactVelocityX = residualVelocity.x;
					impactVelocityZ = residualVelocity.z;
					state.verticalVelocity = Math.max(state.verticalVelocity, verticalVelocity);
					state.impactIntensity = Math.max(state.impactIntensity, intensity);
					state.damage = Math.min(
						1,
						state.damage + Math.max(0, (inwardSpeed - STATIC_COLLISION_DAMAGE_SPEED) / inwardSpeed) * 0.3,
					);
					applyVehicleCrashImpulse(state, {
						heading: state.heading,
						velocityX: reflectedVelocityX - travelVelocityX,
						velocityZ: reflectedVelocityZ - travelVelocityZ,
						intensity,
						verticalVelocity,
					});
				}
			} else {
				state.x = nextX;
				state.z = nextZ;
			}

			updatePhysicsFeedback(
				state,
				deltaSeconds,
				controlInput,
				previousSpeed,
				previousHeading,
				launchSlip,
			);
		},
		unstick,
		getCollisionBody() {
			return {
				x: state.x,
				z: state.z,
				velocityX: velocityX + impactVelocityX,
				velocityZ: velocityZ + impactVelocityZ,
				radius: PLAYER_COLLISION_RADIUS,
				mass: PLAYER_COLLISION_MASS,
			};
		},
		applyImpact(impact) {
			state.x = wrapCoordinate(state.x + impact.correctionX, config.worldSpan);
			state.z = wrapCoordinate(state.z + impact.correctionZ, config.worldSpan);
			const forwardX = Math.sin(state.heading);
			const forwardZ = Math.cos(state.heading);
			const rightX = Math.cos(state.heading);
			const rightZ = -Math.sin(state.heading);
			const existingLateralVelocity = velocityX * rightX + velocityZ * rightZ;
			const longitudinalImpact = impact.velocityX * forwardX + impact.velocityZ * forwardZ;
			const lateralImpactX = impact.velocityX - forwardX * longitudinalImpact;
			const lateralImpactZ = impact.velocityZ - forwardZ * longitudinalImpact;
			state.speed = Math.max(
				-MAX_REVERSE_SPEED,
				Math.min(MAX_SPEED, state.speed + longitudinalImpact),
			);
			velocityX = forwardX * state.speed + rightX * existingLateralVelocity;
			velocityZ = forwardZ * state.speed + rightZ * existingLateralVelocity;
			const knockback = clampVelocityMagnitude(
				impactVelocityX + lateralImpactX,
				impactVelocityZ + lateralImpactZ,
				MAX_IMPACT_KNOCKBACK_SPEED,
			);
			impactVelocityX = knockback.x;
			impactVelocityZ = knockback.z;
			state.verticalVelocity = Math.max(
				state.verticalVelocity,
				Math.min(MAX_IMPACT_VERTICAL_SPEED, impact.verticalVelocity),
			);
			state.impactIntensity = Math.max(0, Math.min(1, Math.max(state.impactIntensity, impact.intensity)));
			applyVehicleCrashImpulse(state, {
				heading: state.heading,
				velocityX: impact.velocityX,
				velocityZ: impact.velocityZ,
				intensity: impact.intensity,
				verticalVelocity: state.verticalVelocity,
			});
			state.damage = Math.min(
				1,
				state.damage + Math.max(0, Math.min(1, impact.damage ?? impact.intensity * 0.4)),
			);
		},
	};
}
