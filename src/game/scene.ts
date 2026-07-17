import * as THREE from 'three';

import { createVehicleController, type VehicleInput } from './vehicle';
import { createRoadIndex, generateWorld, type PropKind, type PropPlacement, type WorldLayout } from './world';

export interface GameTelemetry {
	speed: number;
	surface: 'road' | 'meadow';
	drawCalls: number;
}

export interface GameSceneOptions {
	seed: number;
	readInput: () => VehicleInput;
	onTelemetry: (telemetry: GameTelemetry) => void;
}

export interface GameScene {
	wake(): void;
	destroy(): void;
}

const MAP_OFFSETS = [-1, 0, 1] as const;
const CAMERA_HEIGHT = 34;
const CAMERA_OFFSET = 28;
const VIEW_HEIGHT = 46;

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
	for (const mapX of MAP_OFFSETS) {
		for (const mapZ of MAP_OFFSETS) {
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

function addWorld(scene: THREE.Scene, layout: WorldLayout): void {
	const groundTexture = makeNoiseTexture([111, 148, 91], 26, layout.gridSize * 3);
	const roadTexture = makeNoiseTexture([145, 132, 112], 28, 1);
	const groundMaterial = new THREE.MeshLambertMaterial({ map: groundTexture, color: 0xc3d9a5 });
	const ground = new THREE.Mesh(
		new THREE.PlaneGeometry(layout.worldSpan * 3, layout.worldSpan * 3),
		groundMaterial,
	);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.08;
	scene.add(ground);

	const roadTransforms: THREE.Matrix4[] = [];
	const shoulderTransforms: THREE.Matrix4[] = [];
	const postTransforms: THREE.Matrix4[] = [];
	const capTransforms: THREE.Matrix4[] = [];

	for (const mapX of MAP_OFFSETS) {
		for (const mapZ of MAP_OFFSETS) {
			for (let index = 0; index < layout.roads.length; index += 1) {
				const road = layout.roads[index];
				const x = (road.x + 0.5) * layout.tileSize - layout.worldSpan / 2 + mapX * layout.worldSpan;
				const z = (road.z + 0.5) * layout.tileSize - layout.worldSpan / 2 + mapZ * layout.worldSpan;
				shoulderTransforms.push(matrixAt(x, 0, z, 0, layout.tileSize * 1.03, 0.08, layout.tileSize * 1.03));
				roadTransforms.push(matrixAt(x, 0.08, z, 0, layout.tileSize * 0.94, 0.11, layout.tileSize * 0.94));

				if (index % 9 === 0) {
					postTransforms.push(matrixAt(x + 2.8, 0.72, z + 2.8, 0, 0.14, 1.35, 0.14));
					capTransforms.push(matrixAt(x + 2.8, 1.52, z + 2.8, 0, 0.27, 0.27, 0.27));
				}
			}
		}
	}

	addInstancedMesh(
		scene,
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshLambertMaterial({ color: 0x8d744e }),
		shoulderTransforms,
	);
	addInstancedMesh(
		scene,
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshLambertMaterial({ color: 0xe0d2b7, map: roadTexture }),
		roadTransforms,
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

function addCar(scene: THREE.Scene): { group: THREE.Group; wheels: THREE.Mesh[] } {
	const group = new THREE.Group();
	const red = new THREE.MeshLambertMaterial({ color: 0xd9523f });
	const cream = new THREE.MeshLambertMaterial({ color: 0xf5d99d });
	const glass = new THREE.MeshLambertMaterial({ color: 0x8fc5c2 });
	const dark = new THREE.MeshLambertMaterial({ color: 0x30343b });
	const light = new THREE.MeshBasicMaterial({ color: 0xffefaa });

	const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.65, 4.3), red);
	body.position.y = 0.85;
	group.add(body);

	const hood = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.34, 1.35), cream);
	hood.position.set(0, 1.26, 1.12);
	group.add(hood);

	const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.92, 1.75), glass);
	cabin.position.set(0, 1.58, -0.46);
	group.add(cabin);

	const roof = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.18, 1.92), cream);
	roof.position.set(0, 2.1, -0.46);
	group.add(roof);

	const wheelGeometry = new THREE.CylinderGeometry(0.48, 0.48, 0.36, 8);
	wheelGeometry.rotateZ(Math.PI / 2);
	const wheels: THREE.Mesh[] = [];
	for (const x of [-1.36, 1.36]) {
		for (const z of [-1.32, 1.32]) {
			const wheel = new THREE.Mesh(wheelGeometry, dark);
			wheel.position.set(x, 0.56, z);
			group.add(wheel);
			wheels.push(wheel);
		}
	}

	for (const x of [-0.78, 0.78]) {
		const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.08), light);
		headlight.position.set(x, 0.95, 2.18);
		group.add(headlight);
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
	return { group, wheels };
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
	const controller = createVehicleController({ worldSpan: layout.worldSpan });
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

	addWorld(scene, layout);
	const car = addCar(scene);
	const roadIndex = createRoadIndex(layout);
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
		const delta = Math.min((now - lastTime) / 1000, 0.05);
		lastTime = now;

		const input = options.readInput();
		controller.step(delta, input);
		const { state } = controller;
		car.group.position.x = state.x;
		car.group.position.z = state.z;
		car.group.rotation.y = state.heading;
		for (const wheel of car.wheels) wheel.rotation.x -= state.speed * delta * 0.75;

		camera.position.set(state.x + CAMERA_OFFSET, CAMERA_HEIGHT, state.z - CAMERA_OFFSET);
		camera.lookAt(state.x, 0, state.z);
		renderer.render(scene, camera);

		telemetryElapsed += delta;
		if (telemetryElapsed >= 0.12) {
			telemetryElapsed = 0;
			options.onTelemetry({
				speed: state.speed,
				surface: roadIndex.hasWorldPosition(state.x, state.z) ? 'road' : 'meadow',
				drawCalls: renderer.info.render.calls,
			});
		}

		const hasInput = input.accelerate || input.brake || input.left || input.right;
		idleElapsed = state.speed === 0 && !hasInput ? idleElapsed + delta : 0;
		if (idleElapsed >= 0.25) stopLoop();
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
		destroy() {
			if (destroyed) return;
			destroyed = true;
			stopLoop();
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			resizeObserver.disconnect();
			disposeScene(scene);
			renderer.dispose();
			renderer.domElement.remove();
		},
	};
}
