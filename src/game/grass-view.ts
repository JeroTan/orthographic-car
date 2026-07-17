import * as THREE from 'three';

import fieldGrassTextureUrl from '../assets/grass/grass01.png?url';
import wildGrassTextureUrl from '../assets/grass/grass02.png?url';
import type { GrassKind, WorldLayout } from './world';

export interface GrassView {
	update(elapsedSeconds: number, carX: number, carZ: number): void;
	destroy(): void;
}

const MAP_OFFSETS = [-1, 0, 1] as const;

function createCrossedPlanes(width: number, height: number): THREE.BufferGeometry {
	const halfWidth = width / 2;
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		'position',
		new THREE.Float32BufferAttribute(
			[
				-halfWidth, 0, 0, halfWidth, 0, 0, halfWidth, height, 0, -halfWidth, height, 0,
				0, 0, -halfWidth, 0, 0, halfWidth, 0, height, halfWidth, 0, height, -halfWidth,
			],
			3,
		),
	);
	geometry.setAttribute(
		'uv',
		new THREE.Float32BufferAttribute(
			[0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1],
			2,
		),
	);
	geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
	geometry.computeBoundingSphere();
	return geometry;
}

function createGrassMaterial(texture: THREE.Texture, tint: THREE.Color): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		side: THREE.DoubleSide,
		fog: true,
		uniforms: THREE.UniformsUtils.merge([
			THREE.UniformsLib.fog,
			{
				map: { value: texture },
				tint: { value: tint },
				time: { value: 0 },
				carPosition: { value: new THREE.Vector2() },
			},
		]),
		vertexShader: `
			uniform float time;
			uniform vec2 carPosition;
			varying vec2 vUv;
			#include <fog_pars_vertex>

			void main() {
				vUv = uv;
				float tip = smoothstep(0.0, 1.0, uv.y);
				vec4 basePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
				vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
				float phase = basePosition.x * 0.17 + basePosition.z * 0.13;
				worldPosition.x += sin(time * 1.65 + phase) * 0.18 * tip;
				worldPosition.z += cos(time * 1.25 + phase * 1.37) * 0.08 * tip;

				vec2 carDelta = basePosition.xz - carPosition;
				float carDistance = length(carDelta);
				float contact = 1.0 - smoothstep(0.75, 3.2, carDistance);
				vec2 bendDirection = normalize(carDelta + vec2(0.001));
				worldPosition.xz += bendDirection * contact * 0.95 * tip;
				worldPosition.y -= contact * 0.42 * tip;

				vec4 mvPosition = modelViewMatrix * worldPosition;
				gl_Position = projectionMatrix * mvPosition;
				#include <fog_vertex>
			}
		`,
		fragmentShader: `
			uniform sampler2D map;
			uniform vec3 tint;
			varying vec2 vUv;
			#include <fog_pars_fragment>

			void main() {
				vec4 texel = texture2D(map, vUv);
				if (texel.a < 0.42) discard;
				gl_FragColor = vec4(texel.rgb * tint, 1.0);
				#include <fog_fragment>
				#include <tonemapping_fragment>
				#include <colorspace_fragment>
			}
		`,
	});
}

function addGrassKind(
	scene: THREE.Scene,
	layout: WorldLayout,
	kind: GrassKind,
	geometry: THREE.BufferGeometry,
	material: THREE.ShaderMaterial,
): THREE.InstancedMesh | undefined {
	const placements = layout.grass.filter((grass) => grass.kind === kind);
	if (placements.length === 0) return undefined;

	const instanceCount = placements.length * MAP_OFFSETS.length * MAP_OFFSETS.length;
	const mesh = new THREE.InstancedMesh(geometry, material, instanceCount);
	const matrix = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const rotation = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const euler = new THREE.Euler();
	let index = 0;

	for (const mapX of MAP_OFFSETS) {
		for (const mapZ of MAP_OFFSETS) {
			for (const grass of placements) {
				position.set(
					grass.x + mapX * layout.worldSpan,
					0.035,
					grass.z + mapZ * layout.worldSpan,
				);
				rotation.setFromEuler(euler.set(0, grass.rotation + grass.phase * 0.08, 0));
				scale.setScalar(grass.scale);
				matrix.compose(position, rotation, scale);
				mesh.setMatrixAt(index, matrix);
				index += 1;
			}
		}
	}

	mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
	mesh.computeBoundingSphere();
	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	mesh.renderOrder = 1;
	scene.add(mesh);
	return mesh;
}

export function addGrassView(
	scene: THREE.Scene,
	layout: WorldLayout,
	onAssetReady: () => void,
): GrassView {
	const loader = new THREE.TextureLoader();
	const fieldTexture = loader.load(fieldGrassTextureUrl, onAssetReady);
	const wildTexture = loader.load(wildGrassTextureUrl, onAssetReady);
	for (const texture of [fieldTexture, wildTexture]) {
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.minFilter = THREE.LinearMipmapLinearFilter;
		texture.magFilter = THREE.LinearFilter;
	}

	const fieldMaterial = createGrassMaterial(fieldTexture, new THREE.Color(0xb4cf9c));
	const wildMaterial = createGrassMaterial(wildTexture, new THREE.Color(0xa9c68f));
	addGrassKind(scene, layout, 'field', createCrossedPlanes(2.8, 1.65), fieldMaterial);
	addGrassKind(scene, layout, 'wild', createCrossedPlanes(1.8, 2.15), wildMaterial);

	return {
		update(elapsedSeconds, carX, carZ) {
			for (const material of [fieldMaterial, wildMaterial]) {
				material.uniforms.time.value = elapsedSeconds;
				material.uniforms.carPosition.value.set(carX, carZ);
			}
		},
		destroy() {
			fieldTexture.dispose();
			wildTexture.dispose();
		},
	};
}
