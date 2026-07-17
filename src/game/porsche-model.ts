import * as THREE from 'three';

import bodyTextureUrl from '../assets/porsche-car-model/porsche-body.webp?url';
import porscheModelUrl from '../assets/porsche-car-model/porsche-model.bin?url';
import runningGearTextureUrl from '../assets/porsche-car-model/porsche-running-gear.webp?url';

export type PorscheWheelPosition = 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearRight';

export interface PorscheWheelVisual {
	mesh: THREE.Mesh;
	position: THREE.Vector3;
}

export interface PorscheVisualModel {
	body: THREE.Mesh;
	wheels: Readonly<Record<PorscheWheelPosition, PorscheWheelVisual>>;
	dispose(): void;
}

interface PackedMesh {
	geometry: THREE.BufferGeometry;
	center: THREE.Vector3;
	halfExtent: THREE.Vector3;
}

const MODEL_SCALE = 1.1;
const MODEL_RIDE_HEIGHT = 0.75;
const MODEL_SECTIONS = ['body', 'frontLeft', 'frontRight', 'rearLeft', 'rearRight'] as const;

function configureTexture(texture: THREE.Texture): void {
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
}

function assertViewRange(buffer: ArrayBuffer, offset: number, byteLength: number): void {
	if (offset < 0 || byteLength < 0 || offset + byteLength > buffer.byteLength) {
		throw new Error('Porsche model contains an invalid attribute range.');
	}
}

function parsePackedModel(buffer: ArrayBuffer): Readonly<Record<(typeof MODEL_SECTIONS)[number], PackedMesh>> {
	if (buffer.byteLength < 8 + MODEL_SECTIONS.length * 40) {
		throw new Error('Porsche model header is incomplete.');
	}
	const view = new DataView(buffer);
	const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
	if (magic !== 'PTM1' || view.getUint32(4, true) !== MODEL_SECTIONS.length) {
		throw new Error('Porsche model header is invalid.');
	}

	const sections: Partial<Record<(typeof MODEL_SECTIONS)[number], PackedMesh>> = {};
	for (const [index, name] of MODEL_SECTIONS.entries()) {
		const headerOffset = 8 + index * 40;
		const vertexCount = view.getUint32(headerOffset, true);
		const center = new THREE.Vector3(
			view.getFloat32(headerOffset + 4, true),
			view.getFloat32(headerOffset + 8, true),
			view.getFloat32(headerOffset + 12, true),
		);
		const halfExtent = new THREE.Vector3(
			view.getFloat32(headerOffset + 16, true),
			view.getFloat32(headerOffset + 20, true),
			view.getFloat32(headerOffset + 24, true),
		);
		const positionOffset = view.getUint32(headerOffset + 28, true);
		const normalOffset = view.getUint32(headerOffset + 32, true);
		const uvOffset = view.getUint32(headerOffset + 36, true);
		if (vertexCount === 0 || positionOffset % 2 !== 0 || uvOffset % 2 !== 0) {
			throw new Error('Porsche model attributes are invalid.');
		}
		assertViewRange(buffer, positionOffset, vertexCount * 3 * Int16Array.BYTES_PER_ELEMENT);
		assertViewRange(buffer, normalOffset, vertexCount * 3 * Int8Array.BYTES_PER_ELEMENT);
		assertViewRange(buffer, uvOffset, vertexCount * 2 * Int16Array.BYTES_PER_ELEMENT);

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
			new THREE.Int16BufferAttribute(new Int16Array(buffer, uvOffset, vertexCount * 2), 2, true),
		);
		geometry.computeBoundingSphere();
		sections[name] = { geometry, center, halfExtent };
	}

	return sections as Record<(typeof MODEL_SECTIONS)[number], PackedMesh>;
}

function positionInCar(mesh: THREE.Object3D, section: PackedMesh): void {
	mesh.position.copy(section.center).multiplyScalar(MODEL_SCALE);
	mesh.position.y += MODEL_RIDE_HEIGHT;
	mesh.scale.copy(section.halfExtent).multiplyScalar(MODEL_SCALE);
}

export async function loadPorscheVisualModel(): Promise<PorscheVisualModel> {
	const textureLoader = new THREE.TextureLoader();
	const [response, bodyTexture, runningGearTexture] = await Promise.all([
		fetch(porscheModelUrl),
		textureLoader.loadAsync(bodyTextureUrl),
		textureLoader.loadAsync(runningGearTextureUrl),
	]);
	if (!response.ok) throw new Error(`Porsche model request failed with ${response.status}.`);
	configureTexture(bodyTexture);
	configureTexture(runningGearTexture);

	const packed = parsePackedModel(await response.arrayBuffer());
	const bodyMaterial = new THREE.MeshLambertMaterial({ map: bodyTexture });
	const wheelMaterial = new THREE.MeshLambertMaterial({ map: runningGearTexture });
	const body = new THREE.Mesh(packed.body.geometry, bodyMaterial);
	positionInCar(body, packed.body);

	function makeWheel(position: PorscheWheelPosition): PorscheWheelVisual {
		const section = packed[position];
		const mesh = new THREE.Mesh(section.geometry, wheelMaterial);
		mesh.scale.copy(section.halfExtent).multiplyScalar(MODEL_SCALE);
		return {
			mesh,
			position: section.center
				.clone()
				.multiplyScalar(MODEL_SCALE)
				.add(new THREE.Vector3(0, MODEL_RIDE_HEIGHT, 0)),
		};
	}

	const wheels: Record<PorscheWheelPosition, PorscheWheelVisual> = {
		frontLeft: makeWheel('frontLeft'),
		frontRight: makeWheel('frontRight'),
		rearLeft: makeWheel('rearLeft'),
		rearRight: makeWheel('rearRight'),
	};

	return {
		body,
		wheels,
		dispose() {
			for (const section of Object.values(packed)) section.geometry.dispose();
			bodyMaterial.dispose();
			wheelMaterial.dispose();
			bodyTexture.dispose();
			runningGearTexture.dispose();
		},
	};
}
