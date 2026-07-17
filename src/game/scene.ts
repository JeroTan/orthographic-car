import * as THREE from 'three';

import { addGrassView } from './grass-view';
import { buildRoadSurface } from './road-surface';
import { createVehicleController, type VehicleInput } from './vehicle';
import { addVehicleView } from './vehicle-view';
import { DEFAULT_PORSCHE_COLOR, type PorscheColor } from './porsche-colors';
import {
	createCollisionIndex,
	createTerrainIndex,
	generateWorld,
	getRoadsidePosts,
	REPEATED_WORLD_OFFSETS,
	type PropKind,
	type PropPlacement,
	type WorldLayout,
} from './world';

export interface GameTelemetry {
	speed: number;
	surface: 'road' | 'meadow';
	drawCalls: number;
}

export interface GameSceneOptions {
	seed: number;
	carColor?: PorscheColor;
	readInput: () => VehicleInput;
	onTelemetry: (telemetry: GameTelemetry) => void;
}

export interface GameScene {
	wake(): void;
	setCarColor(color: PorscheColor): void;
	destroy(): void;
}

const CAMERA_HEIGHT = 34;
const CAMERA_OFFSET = 28;
const VIEW_HEIGHT = 46;
const IDLE_FRAME_INTERVAL_MS = 66;
const ROAD_TEXTURE_URL = new URL('../assets/roads/RoadTexture2.jpg', import.meta.url).href;

function makeNoiseTexture(
	base: readonly [number, number, number],
	variation: number,
	repeat: number,
): THREE.DataTexture {
	const size = 16;
	const pixels = new Uint8Array(size * size * 4);
	let state = 0x45d9f3b;

	for (let index = 0; index < size * size; index += 1) {
		state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
		const noise = ((state >>> 24) / 255 - 0.5) * variation;
		const offset = index * 4;
		pixels[offset] = THREE.MathUtils.clamp(base[0] + noise, 0, 255);
		pixels[offset + 1] = THREE.MathUtils.clamp(base[1] + noise, 0, 255);
		pixels[offset + 2] = THREE.MathUtils.clamp(base[2] + noise, 0, 255);
		pixels[offset + 3] = 255;
	}

	const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.repeat.set(repeat, repeat);
	texture.needsUpdate = true;
	return texture;
}

function addInstancedMesh(
	scene: THREE.Scene,
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
	transforms: readonly THREE.Matrix4[],
): THREE.InstancedMesh | undefined {
	if (transforms.length === 0) return undefined;

	const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
	for (let index = 0; index < transforms.length; index += 1) {
		mesh.setMatrixAt(index, transforms[index]);
	}
	mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	mesh.computeBoundingSphere();
	scene.add(mesh);
	return mesh;
}

function matrixAt(
	x: number,
	y: number,
	z: number,
	rotation: number,
	scaleX: number,
	scaleY: number,
	scaleZ: number,
): THREE.Matrix4 {
	return new THREE.Matrix4().compose(
		new THREE.Vector3(x, y, z),
		new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotation, 0)),
		new THREE.Vector3(scaleX, scaleY, scaleZ),
	);
}

function repeatedProps(layout: WorldLayout, kind: PropKind): Array<PropPlacement & { worldX: number; worldZ: number }> {
	const output: Array<PropPlacement & { worldX: number; worldZ: number }> = [];
	for (const mapX of REPEATED_WORLD_OFFSETS) {
		for (const mapZ of REPEATED_WORLD_OFFSETS) {
			for (const prop of layout.props) {
				if (prop.kind === kind) {
					output.push({
						...prop,
						worldX: prop.x + mapX * layout.worldSpan,
						worldZ: prop.z + mapZ * layout.worldSpan,
					});
				}
			}
		}
	}
	return output;
}

function addWorld(scene: THREE.Scene, layout: WorldLayout, onAssetReady: () => void): void {
	const groundTexture = makeNoiseTexture([111, 148, 91], 26, layout.gridSize * 3);
	const roadTexture = new THREE.TextureLoader().load(ROAD_TEXTURE_URL, onAssetReady);
	roadTexture.colorSpace = THREE.SRGBColorSpace;
	roadTexture.wrapS = THREE.RepeatWrapping;
	roadTexture.wrapT = THREE.RepeatWrapping;
	roadTexture.magFilter = THREE.LinearFilter;
	roadTexture.minFilter = THREE.LinearMipmapLinearFilter;
	const groundMaterial = new THREE.MeshLambertMaterial({ map: groundTexture, color: 0xc3d9a5 });
	const ground = new THREE.Mesh(
		new THREE.PlaneGeometry(layout.worldSpan * 3, layout.worldSpan * 3),
		groundMaterial,
	);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.08;
	scene.add(ground);

	const repeatedRoadTransforms: THREE.Matrix4[] = [];
	const postTransforms: THREE.Matrix4[] = [];
	const capTransforms: THREE.Matrix4[] = [];
	const roadsidePosts = getRoadsidePosts(layout);

	for (const mapX of REPEATED_WORLD_OFFSETS) {
		for (const mapZ of REPEATED_WORLD_OFFSETS) {
			repeatedRoadTransforms.push(
				matrixAt(
					mapX * layout.worldSpan,
					0.025,
					mapZ * layout.worldSpan,
					0,
					1,
					1,
					1,
				),
			);

			for (const post of roadsidePosts) {
				const x = post.x + mapX * layout.worldSpan;
				const z = post.z + mapZ * layout.worldSpan;
				postTransforms.push(matrixAt(x, 0.72, z, 0, 0.14, 1.35, 0.14));
				capTransforms.push(matrixAt(x, 1.52, z, 0, 0.27, 0.27, 0.27));
			}
		}
	}

	const roadSurface = buildRoadSurface(layout);
	const roadGeometry = new THREE.BufferGeometry();
	roadGeometry.setAttribute('position', new THREE.BufferAttribute(roadSurface.positions, 3));
	roadGeometry.setAttribute('uv', new THREE.BufferAttribute(roadSurface.uvs, 2));
	roadGeometry.setIndex(roadSurface.indices);
	roadGeometry.computeVertexNormals();
	addInstancedMesh(
		scene,
		roadGeometry,
		new THREE.MeshBasicMaterial({ color: 0xffffff, map: roadTexture }),
		repeatedRoadTransforms,
	);
	addInstancedMesh(
		scene,
		new THREE.CylinderGeometry(1, 1, 1, 5),
		new THREE.MeshLambertMaterial({ color: 0x473e36 }),
		postTransforms,
	);
	addInstancedMesh(
		scene,
		new THREE.OctahedronGeometry(1, 0),
		new THREE.MeshBasicMaterial({ color: 0xffd56b }),
		capTransforms,
	);

	const trees = repeatedProps(layout, 'tree');
	const treeTrunks = trees.map((tree) => {
		return matrixAt(tree.worldX, tree.scale, tree.worldZ, tree.rotation, 0.34 * tree.scale, 2 * tree.scale, 0.34 * tree.scale);
	});
	const treeCrowns = trees.map((tree) => {
		return matrixAt(tree.worldX, 2.5 * tree.scale, tree.worldZ, tree.rotation, 1.65 * tree.scale, 1.9 * tree.scale, 1.65 * tree.scale);
	});
	addInstancedMesh(
		scene,
		new THREE.CylinderGeometry(1, 1, 1, 5),
		new THREE.MeshLambertMaterial({ color: 0x78533e }),
		treeTrunks,
	);
	addInstancedMesh(
		scene,
		new THREE.IcosahedronGeometry(1, 0),
		new THREE.MeshLambertMaterial({ color: 0x416f49, flatShading: true }),
		treeCrowns,
	);

	const rocks = repeatedProps(layout, 'rock').map((rock) => {
		return matrixAt(rock.worldX, 0.48 * rock.scale, rock.worldZ, rock.rotation, 0.9 * rock.scale, 0.6 * rock.scale, 0.75 * rock.scale);
	});
	addInstancedMesh(
		scene,
		new THREE.DodecahedronGeometry(1, 0),
		new THREE.MeshLambertMaterial({ color: 0x8a9188, flatShading: true }),
		rocks,
	);

	const flowers = repeatedProps(layout, 'flowers').map((flower) => {
		return matrixAt(flower.worldX, 0.28, flower.worldZ, flower.rotation, 0.28 * flower.scale, 0.5 * flower.scale, 0.28 * flower.scale);
	});
	addInstancedMesh(
		scene,
		new THREE.OctahedronGeometry(1, 0),
		new THREE.MeshBasicMaterial({ color: 0xffbdc7 }),
		flowers,
	);

	const cottages = repeatedProps(layout, 'cottage');
	const cottageBodies = cottages.map((cottage) => {
		return matrixAt(cottage.worldX, 0.75 * cottage.scale, cottage.worldZ, cottage.rotation, 2 * cottage.scale, 1.5 * cottage.scale, 1.7 * cottage.scale);
	});
	const cottageRoofs = cottages.map((cottage) => {
		return matrixAt(cottage.worldX, 2.05 * cottage.scale, cottage.worldZ, cottage.rotation + Math.PI / 4, 2.25 * cottage.scale, 1.35 * cottage.scale, 2.05 * cottage.scale);
	});
	addInstancedMesh(
		scene,
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshLambertMaterial({ color: 0xf1dfb4 }),
		cottageBodies,
	);
	addInstancedMesh(
		scene,
		new THREE.ConeGeometry(1, 1, 4),
		new THREE.MeshLambertMaterial({ color: 0xa84f3c, flatShading: true }),
		cottageRoofs,
	);
}

function disposeScene(scene: THREE.Scene): void {
	const geometries = new Set<THREE.BufferGeometry>();
	const materials = new Set<THREE.Material>();
	const textures = new Set<THREE.Texture>();

	scene.traverse((object) => {
		if (!(object instanceof THREE.Mesh)) return;
		geometries.add(object.geometry);
		const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
		for (const material of meshMaterials) {
			materials.add(material);
			for (const value of Object.values(material)) {
				if (value instanceof THREE.Texture) textures.add(value);
			}
		}
	});

	for (const geometry of geometries) geometry.dispose();
	for (const material of materials) material.dispose();
	for (const texture of textures) texture.dispose();
}

export function createGameScene(container: HTMLElement, options: GameSceneOptions): GameScene {
	const layout = generateWorld(options.seed);
	const roadIndex = createTerrainIndex(layout);
	const controller = createVehicleController({
		worldSpan: layout.worldSpan,
		collision: createCollisionIndex(layout),
		terrain: roadIndex,
	});
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0xc8ddd1);
	scene.fog = new THREE.Fog(0xc8ddd1, 72, 160);

	const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 260);
	const renderer = new THREE.WebGLRenderer({
		antialias: false,
		alpha: false,
		powerPreference: 'low-power',
		precision: 'mediump',
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.domElement.setAttribute('aria-label', 'Orthographic procedural driving world');
	renderer.domElement.setAttribute('role', 'img');
	container.append(renderer.domElement);

	scene.add(new THREE.HemisphereLight(0xfff3d0, 0x506c60, 2.45));
	const sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
	sun.position.set(-24, 48, -18);
	scene.add(sun);

	addWorld(scene, layout, () => startLoop());
	const grassView = addGrassView(scene, layout, () => startLoop());
	const vehicleView = addVehicleView(
		scene,
		() => startLoop(),
		options.carColor ?? DEFAULT_PORSCHE_COLOR,
	);
	let destroyed = false;
	let lastTime = performance.now();
	let telemetryElapsed = 0;
	let idleElapsed = 0;
	let running = false;

	function resize(): void {
		const width = Math.max(container.clientWidth, 1);
		const height = Math.max(container.clientHeight, 1);
		const aspect = width / height;
		camera.left = (-VIEW_HEIGHT * aspect) / 2;
		camera.right = (VIEW_HEIGHT * aspect) / 2;
		camera.top = VIEW_HEIGHT / 2;
		camera.bottom = -VIEW_HEIGHT / 2;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height, false);
		startLoop();
	}

	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(container);
	resize();

	function frame(now: number): void {
		if (destroyed) return;
		const input = options.readInput();
		const hasInput = input.accelerate || input.brake || input.left || input.right || input.handbrake;
		if (idleElapsed >= 0.25 && !hasInput && now - lastTime < IDLE_FRAME_INTERVAL_MS) return;
		const delta = Math.min((now - lastTime) / 1000, 0.05);
		lastTime = now;

		controller.step(delta, input);
		const { state } = controller;
		const effectsActive = vehicleView.update(delta, state);
		grassView.update(now / 1000, state);

		camera.position.set(state.x + CAMERA_OFFSET, CAMERA_HEIGHT, state.z - CAMERA_OFFSET);
		camera.lookAt(state.x, 0, state.z);
		renderer.render(scene, camera);

		telemetryElapsed += delta;
		if (telemetryElapsed >= 0.12) {
			telemetryElapsed = 0;
			options.onTelemetry({
				speed: state.speed,
				surface: roadIndex.surfaceAt(state.x, state.z),
				drawCalls: renderer.info.render.calls,
			});
		}

		idleElapsed = state.speed === 0 && !hasInput && !effectsActive ? idleElapsed + delta : 0;
	}

	function startLoop(): void {
		if (destroyed || running || document.hidden) return;
		running = true;
		lastTime = performance.now();
		renderer.setAnimationLoop(frame);
	}

	function stopLoop(): void {
		if (!running) return;
		running = false;
		renderer.setAnimationLoop(null);
	}

	function handleVisibilityChange(): void {
		if (document.hidden) stopLoop();
		else startLoop();
	}

	document.addEventListener('visibilitychange', handleVisibilityChange);
	startLoop();

	return {
		wake: startLoop,
		setCarColor(color) {
			vehicleView.setColor(color);
			startLoop();
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			stopLoop();
			vehicleView.destroy();
			grassView.destroy();
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			resizeObserver.disconnect();
			disposeScene(scene);
			renderer.dispose();
			renderer.domElement.remove();
		},
	};
}
