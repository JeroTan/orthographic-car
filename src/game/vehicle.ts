export interface VehicleInput {
	accelerate: boolean;
	brake: boolean;
	left: boolean;
	right: boolean;
}

export interface VehicleState {
	x: number;
	z: number;
	heading: number;
	speed: number;
}

export interface VehicleController {
	readonly state: VehicleState;
	step(deltaSeconds: number, input: VehicleInput): void;
}

interface VehicleConfig {
	worldSpan: number;
}

const ACCELERATION = 9;
const BRAKING = 14;
const REVERSE_ACCELERATION = 7;
const COAST_DRAG = 2.4;
const MAX_SPEED = 26;
const MAX_REVERSE_SPEED = 12;
const STEERING_RATE = 1.8;

function wrapCoordinate(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

function coastTowardStop(speed: number, amount: number): number {
	if (speed > 0) return Math.max(0, speed - amount);
	if (speed < 0) return Math.min(0, speed + amount);
	return 0;
}

export function createVehicleController(config: VehicleConfig): VehicleController {
	const state: VehicleState = { x: 0, z: 0, heading: 0, speed: 0 };

	return {
		state,
		step(deltaSeconds, input) {
			if (input.accelerate && !input.brake) {
				state.speed =
					state.speed < 0
						? Math.min(0, state.speed + BRAKING * deltaSeconds)
						: Math.min(MAX_SPEED, state.speed + ACCELERATION * deltaSeconds);
			} else if (input.brake && !input.accelerate) {
				state.speed =
					state.speed > 0
						? Math.max(0, state.speed - BRAKING * deltaSeconds)
						: Math.max(-MAX_REVERSE_SPEED, state.speed - REVERSE_ACCELERATION * deltaSeconds);
			} else {
				state.speed = coastTowardStop(state.speed, COAST_DRAG * deltaSeconds);
			}

			const steering = Number(input.left) - Number(input.right);
			if (steering !== 0 && state.speed !== 0) {
				const speedRatio = Math.abs(state.speed) / (state.speed > 0 ? MAX_SPEED : MAX_REVERSE_SPEED);
				const steeringGrip = 0.35 + 0.65 * speedRatio;
				state.heading +=
					steering * Math.sign(state.speed) * STEERING_RATE * steeringGrip * deltaSeconds;
			}

			state.x += Math.sin(state.heading) * state.speed * deltaSeconds;
			state.z += Math.cos(state.heading) * state.speed * deltaSeconds;
			state.x = wrapCoordinate(state.x, config.worldSpan);
			state.z = wrapCoordinate(state.z, config.worldSpan);
		},
	};
}
