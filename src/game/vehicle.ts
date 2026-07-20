export interface VehicleInput {
	accelerate: boolean;
	brake: boolean;
	left: boolean;
	right: boolean;
	handbrake?: boolean;
}

export interface VehicleState {
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
}

export interface VehicleController {
	readonly state: VehicleState;
	step(deltaSeconds: number, input: VehicleInput): void;
}

export interface CollisionQuery {
	intersectsCircle(x: number, z: number, radius: number): boolean;
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

const ACCELERATION = 2.2;
const MEADOW_ACCELERATION = 1.35;
const BRAKING = 14;
const REVERSE_ACCELERATION = 7;
const MEADOW_REVERSE_ACCELERATION = 4.5;
const COAST_DRAG = 2.4;
const MAX_SPEED = 26;
const MAX_MEADOW_SPEED = 14;
const MEADOW_OVERSPEED_DRAG = 8;
const GRASS_ROLLING_DRAG = 1.1;
const GRASS_SPEED_DRAG = 0.12;
const MAX_REVERSE_SPEED = 12;
const MAX_MEADOW_REVERSE_SPEED = 7;
const STEERING_RATE = 1.8;
const MAX_STEERING_ANGLE = 0.5;
const STEERING_RESPONSE = 4.5;
const TURNING_DRAG = 4;
const HANDBRAKE_DRAG = 6;
const HANDBRAKE_YAW_BOOST = 1.65;
const ROAD_GRIP = 10;
const BRAKING_REAR_GRIP = 4.5;
const HANDBRAKE_REAR_GRIP = 1.2;
const HANDBRAKE_THROTTLE_FACTOR = 0.25;
const CAR_COLLISION_RADIUS = 1.25;
const CAR_COLLISION_OFFSET = 1.1;
const SPEED_ACCELERATION_TAPER = 0.8;
const SPEED_ACCELERATION_CURVE = 1.6;
const WORLD_SPEED_TO_KMH = 12.65;

export function toSpeedometerKmh(longitudinalSpeed: number): number {
	return Math.round(Math.abs(longitudinalSpeed) * WORLD_SPEED_TO_KMH);
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

function speedAccelerationFactor(speed: number, maxForwardSpeed: number): number {
	const speedRatio = Math.max(0, Math.min(1, speed / maxForwardSpeed));
	return 1 - SPEED_ACCELERATION_TAPER * Math.pow(speedRatio, SPEED_ACCELERATION_CURVE);
}

function updateLongitudinalSpeed(
	speed: number,
	deltaSeconds: number,
	input: VehicleInput,
	handling: SurfaceHandling,
): number {
	let nextSpeed = speed;
	const driveAcceleration =
		handling.acceleration *
		speedAccelerationFactor(speed, handling.maxForwardSpeed) *
		(input.handbrake ? HANDBRAKE_THROTTLE_FACTOR : 1);

	if (input.accelerate && !input.brake) {
		nextSpeed =
			speed < 0
				? Math.min(0, speed + BRAKING * deltaSeconds)
				: speed > handling.maxForwardSpeed
					? Math.max(
							handling.maxForwardSpeed,
							speed - MEADOW_OVERSPEED_DRAG * deltaSeconds,
						)
					: Math.min(
							handling.maxForwardSpeed,
							speed + driveAcceleration * deltaSeconds,
						);
	} else if (input.brake && !input.accelerate) {
		nextSpeed =
			speed > 0
				? Math.max(0, speed - BRAKING * deltaSeconds)
				: Math.max(
						-handling.maxReverseSpeed,
						speed - handling.reverseAcceleration * deltaSeconds,
					);
	} else {
		nextSpeed = coastTowardStop(speed, COAST_DRAG * deltaSeconds);
	}

	return input.handbrake
		? coastTowardStop(nextSpeed, HANDBRAKE_DRAG * deltaSeconds)
		: nextSpeed;
}

function updateSteering(
	state: VehicleState,
	deltaSeconds: number,
	input: VehicleInput,
	handling: SurfaceHandling,
): void {
	const steering = Number(input.left) - Number(input.right);
	const targetSteeringAngle = steering * MAX_STEERING_ANGLE;
	const steeringStep = STEERING_RESPONSE * deltaSeconds;
	state.steeringAngle += Math.max(
		-steeringStep,
		Math.min(steeringStep, targetSteeringAngle - state.steeringAngle),
	);
	if (steering === 0 || state.speed === 0) return;

	const speedRatio =
		Math.abs(state.speed) /
		(state.speed > 0 ? handling.maxForwardSpeed : handling.maxReverseSpeed);
	const steeringGrip = 0.35 + 0.65 * speedRatio;
	state.heading +=
		steering *
		Math.sign(state.speed) *
		STEERING_RATE *
		steeringGrip *
		(input.handbrake ? HANDBRAKE_YAW_BOOST : 1) *
		deltaSeconds;
	state.speed = coastTowardStop(state.speed, TURNING_DRAG * speedRatio * deltaSeconds);
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
					Math.min(1, ((state.heading - previousHeading) / deltaSeconds) * Math.abs(state.speed) / 32),
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

function collidesAt(collision: CollisionQuery, x: number, z: number, heading: number): boolean {
	const offsetX = Math.sin(heading) * CAR_COLLISION_OFFSET;
	const offsetZ = Math.cos(heading) * CAR_COLLISION_OFFSET;
	return (
		collision.intersectsCircle(x + offsetX, z + offsetZ, CAR_COLLISION_RADIUS) ||
		collision.intersectsCircle(x - offsetX, z - offsetZ, CAR_COLLISION_RADIUS)
	);
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
	};
	let velocityX = 0;
	let velocityZ = 0;

	return {
		state,
		step(deltaSeconds, input) {
			const previousSpeed = state.speed;
			const previousHeading = state.heading;
			const surface = config.terrain?.surfaceAt(state.x, state.z) ?? 'road';
			const handling = SURFACE_HANDLING[surface];
			state.speed = updateLongitudinalSpeed(state.speed, deltaSeconds, input, handling);
			updateSteering(state, deltaSeconds, input, handling);
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
				input.accelerate && !input.brake && previousSpeed >= 0 && state.speed < 6
					? 1 - state.speed / 6
					: 0;
			const lateralVelocity = velocityX * rightX + velocityZ * rightZ;
			const poweredRearGrip = ROAD_GRIP * (1 - launchSlip * 0.45);
			const hardBraking = input.brake && !input.accelerate && previousSpeed > 8;
			const grip = input.handbrake
				? HANDBRAKE_REAR_GRIP
				: hardBraking
					? BRAKING_REAR_GRIP
					: poweredRearGrip;
			const retainedLateralVelocity = lateralVelocity * Math.max(0, 1 - grip * deltaSeconds);
			velocityX = forwardX * state.speed + rightX * retainedLateralVelocity;
			velocityZ = forwardZ * state.speed + rightZ * retainedLateralVelocity;
			state.slipAngle = Math.atan2(retainedLateralVelocity, Math.max(Math.abs(state.speed), 0.01));

			const nextX = wrapCoordinate(
				state.x + velocityX * deltaSeconds,
				config.worldSpan,
			);
			const nextZ = wrapCoordinate(
				state.z + velocityZ * deltaSeconds,
				config.worldSpan,
			);

			if (config.collision && collidesAt(config.collision, nextX, nextZ, state.heading)) {
				state.speed = 0;
				state.slipAngle = 0;
				velocityX = 0;
				velocityZ = 0;
			} else {
				state.x = nextX;
				state.z = nextZ;
			}

			updatePhysicsFeedback(
				state,
				deltaSeconds,
				input,
				previousSpeed,
				previousHeading,
				launchSlip,
			);
		},
	};
}
