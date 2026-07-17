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
const COAST_DRAG = 2.4;
const MAX_SPEED = 26;
const STEERING_RATE = 1.8;

function wrapCoordinate(value: number, span: number): number {
	const halfSpan = span / 2;
	return ((((value + halfSpan) % span) + span) % span) - halfSpan;
}

export function createVehicleController(config: VehicleConfig): VehicleController {
	const state: VehicleState = { x: 0, z: 0, heading: 0, speed: 0 };

	return {
		state,
		step(deltaSeconds, input) {
			if (input.accelerate) {
				state.speed = Math.min(MAX_SPEED, state.speed + ACCELERATION * deltaSeconds);
			}

			if (input.brake) {
				state.speed = Math.max(0, state.speed - BRAKING * deltaSeconds);
			}

			if (!input.accelerate && !input.brake) {
				state.speed = Math.max(0, state.speed - COAST_DRAG * deltaSeconds);
			}

			const steering = Number(input.right) - Number(input.left);
			if (steering !== 0 && state.speed > 0) {
				const steeringGrip = 0.35 + 0.65 * (state.speed / MAX_SPEED);
				state.heading += steering * STEERING_RATE * steeringGrip * deltaSeconds;
			}

			state.x += Math.sin(state.heading) * state.speed * deltaSeconds;
			state.z += Math.cos(state.heading) * state.speed * deltaSeconds;
			state.x = wrapCoordinate(state.x, config.worldSpan);
			state.z = wrapCoordinate(state.z, config.worldSpan);
		},
	};
}
