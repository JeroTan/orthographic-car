import * as THREE from 'three';

import trafficModelsUrl from '../assets/traffic-models/traffic-models.bin?url';
import { TRAFFIC_MODEL_IDS } from './traffic-vehicle-catalog';

export interface PackedTrafficModel {
	readonly geometry: THREE.BufferGeometry;
	readonly centerMeters: THREE.Vector3;
	readonly halfExtentMeters: THREE.Vector3;
}

const MODEL_MAGIC = 'TVM2';
const MODEL_RECORD_BYTES = 76;
const MODEL_ID_BYTES = 32;
let modelLoad: Promise<ReadonlyMap<string, PackedTrafficModel>> | undefined;

function assertViewRange(buffer: ArrayBuffer, offset: number, byteLength: number): void {
	if (offset < 0 || byteLength < 0 || offset + byteLength > buffer.byteLength) {
		throw new Error('Traffic model contains an invalid attribute range.');
	}
}

function readModelId(buffer: ArrayBuffer, offset: number, length: number): string {
	if (length <= 0 || length > MODEL_ID_BYTES) throw new Error('Traffic model id is invalid.');
	return new TextDecoder().decode(new Uint8Array(buffer, offset, length));
}

export function parseTrafficModels(buffer: ArrayBuffer): ReadonlyMap<string, PackedTrafficModel> {
	if (buffer.byteLength < 12) throw new Error('Traffic model header is incomplete.');
	const view = new DataView(buffer);
	const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
	const count = view.getUint32(4, true);
	const headerSize = view.getUint32(8, true);
	if (magic !== MODEL_MAGIC || count !== TRAFFIC_MODEL_IDS.length || headerSize !== 12 + count * MODEL_RECORD_BYTES) {
		throw new Error('Traffic model header is invalid.');
	}
	if (headerSize > buffer.byteLength) throw new Error('Traffic model header exceeds source.');

	const models = new Map<string, PackedTrafficModel>();
	const expectedIds = new Set<string>(TRAFFIC_MODEL_IDS);
	for (let index = 0; index < count; index += 1) {
		const offset = 12 + index * MODEL_RECORD_BYTES;
		const id = readModelId(buffer, offset + 1, view.getUint8(offset));
		const vertexCount = view.getUint32(offset + 36, true);
		const positionOffset = view.getUint32(offset + 64, true);
		const normalOffset = view.getUint32(offset + 68, true);
		const uvOffset = view.getUint32(offset + 72, true);
		if (
			!expectedIds.has(id) ||
			models.has(id) ||
			vertexCount === 0 ||
			positionOffset % 2 !== 0 ||
			uvOffset % 2 !== 0
		) {
			throw new Error('Traffic model attributes are invalid.');
		}
		assertViewRange(buffer, positionOffset, vertexCount * 3 * Int16Array.BYTES_PER_ELEMENT);
		assertViewRange(buffer, normalOffset, vertexCount * 3 * Int8Array.BYTES_PER_ELEMENT);
		assertViewRange(buffer, uvOffset, vertexCount * 2 * Uint16Array.BYTES_PER_ELEMENT);
		const centerMeters = new THREE.Vector3(
			view.getFloat32(offset + 40, true),
			view.getFloat32(offset + 44, true),
			view.getFloat32(offset + 48, true),
		);
		const halfExtentMeters = new THREE.Vector3(
			view.getFloat32(offset + 52, true),
			view.getFloat32(offset + 56, true),
			view.getFloat32(offset + 60, true),
		);
		if (
			!centerMeters.toArray().every(Number.isFinite) ||
			halfExtentMeters.x <= 0 ||
			halfExtentMeters.y <= 0 ||
			halfExtentMeters.z <= 0
		) {
			throw new Error('Traffic model dimensions are invalid.');
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			'position',
			new THREE.Int16BufferAttribute(new Int16Array(buffer, positionOffset, vertexCount * 3), 3, true),
		);
		geometry.setAttribute(
			'normal',
			new THREE.Int8BufferAttribute(new Int8Array(buffer, normalOffset, vertexCount * 3), 3, true),
		);
		geometry.setAttribute(
			'uv',
			new THREE.Uint16BufferAttribute(new Uint16Array(buffer, uvOffset, vertexCount * 2), 2, true),
		);
		geometry.computeBoundingSphere();
		models.set(id, { geometry, centerMeters, halfExtentMeters });
	}
	if (models.size !== expectedIds.size) throw new Error('Traffic model catalog is incomplete.');
	return models;
}

export function loadTrafficModels(): Promise<ReadonlyMap<string, PackedTrafficModel>> {
	modelLoad ??= fetch(trafficModelsUrl).then(async (response) => {
		if (!response.ok) throw new Error(`Traffic model request failed with ${response.status}.`);
		return parseTrafficModels(await response.arrayBuffer());
	});
	return modelLoad;
}
