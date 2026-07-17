import * as THREE from 'three';

import buildingModelUrl from '../assets/buildings/residential-buildings.bin?url';
import buildingTextureUrl from '../assets/buildings/residential-buildings.webp?url';
import {
	type BuildingVariant,
	type WorldLayout,
	type WorldPoint,
} from './world';

export interface BuildingView {
	update(carPosition: WorldPoint): void;
	destroy(): void;
}

interface PackedBuildingVariant {
	geometry: THREE.BufferGeometry;
	halfExtent: THREE.Vector3;
}

interface BuildingInstances {
	mesh: THREE.InstancedMesh;
	packed: PackedBuildingVariant;
	placements: WorldLayout['buildings'];
}

interface TransformScratch {
	matrix: THREE.Matrix4;
	position: THREE.Vector3;
	rotation: THREE.Quaternion;
	euler: THREE.Euler;
	scale: THREE.Vector3;
}

const VARIANT_COUNT = 6;
const SECTION_HEADER_SIZE = 32;
const MODEL_SCALE = 0.25;
const VARIANT_COLORS = [0xd9c7ad, 0xc9b28f, 0xc48f79, 0xa8bec2, 0xa7b49a, 0xb8afa4] as const;

function assertViewRange(buffer: ArrayBuffer, offset: number, byteLength: number): void {
	if (offset < 0 || byteLength < 0 || offset + byteLength > buffer.byteLength) {
		throw new Error('Residential building model contains an invalid attribute range.');
	}
}

function parseBuildingModel(buffer: ArrayBuffer): PackedBuildingVariant[] {
	if (buffer.byteLength < 8 + VARIANT_COUNT * SECTION_HEADER_SIZE) {
		throw new Error('Residential building model header is incomplete.');
	}
	const view = new DataView(buffer);
	const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
	if (magic !== 'BLD1' || view.getUint32(4, true) !== VARIANT_COUNT) {
		throw new Error('Residential building model header is invalid.');
	}

	return Array.from({ length: VARIANT_COUNT }, (_, index) => {
		const offset = 8 + index * SECTION_HEADER_SIZE;
		const vertexCount = view.getUint32(offset, true);
		const halfExtent = new THREE.Vector3(
			view.getFloat32(offset + 4, true),
			view.getFloat32(offset + 8, true),
			view.getFloat32(offset + 12, true),
		);
		const positionOffset = view.getUint32(offset + 16, true);
		const normalOffset = view.getUint32(offset + 20, true);
		const uvOffset = view.getUint32(offset + 24, true);
		if (vertexCount === 0 || vertexCount % 3 !== 0 || positionOffset % 2 !== 0 || uvOffset % 2 !== 0) {
			throw new Error('Residential building model attributes are invalid.');
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
		return { geometry, halfExtent };
	});
}

function addVariantInstances(
	scene: THREE.Scene,
	layout: WorldLayout,
	variant: BuildingVariant,
	packed: PackedBuildingVariant,
	material: THREE.Material,
): BuildingInstances | undefined {
	const placements = layout.buildings.filter((building) => building.variant === variant);
	if (placements.length === 0) return undefined;

	const mesh = new THREE.InstancedMesh(packed.geometry, material, placements.length);
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mesh.frustumCulled = false;
	scene.add(mesh);
	return { mesh, packed, placements };
}

function wrappedNear(value: number, origin: number, span: number): number {
	return origin + ((((value - origin + span / 2) % span) + span) % span) - span / 2;
}

function updateInstances(
	instances: readonly BuildingInstances[],
	carPosition: WorldPoint,
	worldSpan: number,
	scratch: TransformScratch,
): void {
	for (const variantInstances of instances) {
		for (let index = 0; index < variantInstances.placements.length; index += 1) {
			const building = variantInstances.placements[index];
			const modelScale = MODEL_SCALE * building.scale;
			scratch.position.set(
				wrappedNear(building.x, carPosition.x, worldSpan),
				variantInstances.packed.halfExtent.y * modelScale + 0.02,
				wrappedNear(building.z, carPosition.z, worldSpan),
			);
			scratch.rotation.setFromEuler(scratch.euler.set(0, building.rotation, 0));
			scratch.scale.copy(variantInstances.packed.halfExtent).multiplyScalar(modelScale);
			scratch.matrix.compose(scratch.position, scratch.rotation, scratch.scale);
			variantInstances.mesh.setMatrixAt(index, scratch.matrix);
		}
		variantInstances.mesh.instanceMatrix.needsUpdate = true;
	}
}

export function addBuildingView(
	scene: THREE.Scene,
	layout: WorldLayout,
	onAssetReady: () => void,
): BuildingView {
	let destroyed = false;
	let loadedTexture: THREE.Texture | undefined;
	let loadedVariants: PackedBuildingVariant[] = [];
	let latestCarPosition: WorldPoint = { x: 0, z: 0 };
	const instances: BuildingInstances[] = [];
	const transformScratch: TransformScratch = {
		matrix: new THREE.Matrix4(),
		position: new THREE.Vector3(),
		rotation: new THREE.Quaternion(),
		euler: new THREE.Euler(),
		scale: new THREE.Vector3(),
	};
	void Promise.all([
		fetch(buildingModelUrl),
		new THREE.TextureLoader().loadAsync(buildingTextureUrl),
	])
		.then(async ([response, texture]) => {
			if (!response.ok) throw new Error(`Residential building request failed with ${response.status}.`);
			const variants = parseBuildingModel(await response.arrayBuffer());
			if (destroyed) {
				for (const variant of variants) variant.geometry.dispose();
				texture.dispose();
				return;
			}

			texture.colorSpace = THREE.SRGBColorSpace;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.magFilter = THREE.LinearFilter;
			loadedTexture = texture;
			loadedVariants = variants;
			for (let index = 0; index < variants.length; index += 1) {
				const material = new THREE.MeshLambertMaterial({
					map: texture,
					color: VARIANT_COLORS[index],
				});
				const variantInstances = addVariantInstances(
					scene,
					layout,
					index as BuildingVariant,
					variants[index],
					material,
				);
				if (variantInstances) instances.push(variantInstances);
			}
			updateInstances(instances, latestCarPosition, layout.worldSpan, transformScratch);
			onAssetReady();
		})
		.catch((error: unknown) => {
			console.warn('Residential buildings could not load.', error);
		});

	return {
		update(carPosition) {
			latestCarPosition = carPosition;
			if (instances.length > 0) {
				updateInstances(instances, carPosition, layout.worldSpan, transformScratch);
			}
		},
		destroy() {
			destroyed = true;
			for (const variant of loadedVariants) variant.geometry.dispose();
			loadedTexture?.dispose();
		},
	};
}
