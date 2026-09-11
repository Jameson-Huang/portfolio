const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('.site-nav');

menuButton?.addEventListener('click', () => {
  const open = nav.classList.toggle('visible');
  menuButton.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('.site-nav a').forEach((link) =>
  link.addEventListener('click', () => {
    nav.classList.remove('visible');
    menuButton?.setAttribute('aria-expanded', 'false');
  })
);

document.querySelectorAll('.project-toggle').forEach((button) =>
  button.addEventListener('click', () => {
    const project = button.closest('.project');
    const open = project.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
    button.firstChild.textContent = open
      ? 'Hide project scope '
      : 'View project scope ';
  })
);

document.querySelector('#year').textContent = new Date().getFullYear();

const canvas = document.querySelector('#print-canvas');
const partSelect = document.querySelector('#part-select');
const replayButton = document.querySelector('#replay-print');
const printStatus = document.querySelector('#print-status');

const partFiles = [
  { name: 'Body aft', path: 'assets/aircraft-models/body-aft.stl' },
  { name: 'Body nose', path: 'assets/aircraft-models/body-nose.stl' },
  { name: 'Middle wing', path: 'assets/aircraft-models/middle-wing.stl' },
  { name: 'Vertical stabilizer', path: 'assets/aircraft-models/vertical-stabilizer.stl' },
];

let meshes = [];
let activePart = 0;
let printStarted = performance.now();

function parseStl(buffer) {
  const view = new DataView(buffer);
  const count =
    buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;

  const binary = 84 + count * 50 === buffer.byteLength;
  const triangles = [];

  if (binary) {
    for (
      let offset = 84;
      offset + 48 <= buffer.byteLength;
      offset += 50
    ) {
      const triangle = [];

      for (let vertex = 0; vertex < 3; vertex += 1) {
        const point = offset + 12 + vertex * 12;

        triangle.push([
          view.getFloat32(point, true),
          view.getFloat32(point + 4, true),
          view.getFloat32(point + 8, true),
        ]);
      }

      triangles.push(triangle);
    }
  } else {
    const text = new TextDecoder().decode(buffer);

    const points = [
      ...text.matchAll(
        /vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/g
      ),
    ].map((match) => [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ]);

    for (let index = 0; index + 2 < points.length; index += 3) {
      triangles.push(points.slice(index, index + 3));
    }
  }

  const all = triangles.flat();

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  all.forEach((point) =>
    point.forEach((value, axis) => {
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    })
  );

  const center = min.map(
    (value, axis) => (value + max[axis]) / 2
  );

  const size =
    Math.max(...max.map((value, axis) => value - min[axis])) || 1;

  const step = Math.max(
    1,
    Math.ceil(triangles.length / 5200)
  );

  return {
    triangles: triangles
      .filter((_, index) => index % step === 0)
      .map((triangle) =>
        triangle.map((point) =>
          point.map(
            (value, axis) =>
              (value - center[axis]) / size
          )
        )
      ),
    minZ: (min[2] - center[2]) / size,
    maxZ: (max[2] - center[2]) / size,
  };
}

async function loadPrintFiles() {
  try {
    meshes = await Promise.all(
      partFiles.map(async (part) =>
        parseStl(
          await (
            await fetch(part.path)
          ).arrayBuffer()
        )
      )
    );

    printStatus.textContent = '4 STL files loaded';
    requestAnimationFrame(drawPrint);
  } catch {
    printStatus.textContent = 'Preview unavailable';
  }
}

function clipAtLayer(points, layer) {
  const clipped = [];

  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];

    const inside = point[2] <= layer;
    const nextInside = next[2] <= layer;

    if (inside) clipped.push(point);

    if (inside !== nextInside) {
      const ratio =
        (layer - point[2]) /
        (next[2] - point[2]);

      clipped.push([
        point[0] + (next[0] - point[0]) * ratio,
        point[1] + (next[1] - point[1]) * ratio,
        layer,
      ]);
    }
  });

  return clipped;
}

function drawPrint(time) {
  if (!canvas || !meshes.length) return;

  const context = canvas.getContext('2d');
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = window.devicePixelRatio || 1;

  if (
    canvas.width !== width * ratio ||
    canvas.height !== height * ratio
  ) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const mesh = meshes[activePart];

  const elapsed = (time - printStarted) / 1000;

  const rawProgress = Math.min(
    1,
    (elapsed % 15) / 12
  );

  const layerNumber = Math.floor(
    rawProgress * 150
  );

  const progress = layerNumber / 150;

  const rotation =
    -0.62 +
    Math.sin(elapsed * 0.15) * 0.26;

  const scale =
    Math.min(width, height) * 0.52;

  const project = ([x, y, z]) => {
    const turnedX =
      x * Math.cos(rotation) -
      y * Math.sin(rotation);

    const depth =
      x * Math.sin(rotation) +
      y * Math.cos(rotation);

    return [
      width / 2 + turnedX * scale,
      height * 0.65 -
        z * scale +
        depth * scale * 0.34,
      depth,
    ];
  };

  context.strokeStyle =
    'rgba(216,255,62,.22)';

  context.lineWidth = 1;

  context.beginPath();

  context.ellipse(
    width / 2,
    height * 0.76,
    width * 0.34,
    height * 0.09,
    0,
    0,
    Math.PI * 2
  );

  context.stroke();

  const threshold =
    mesh.minZ +
    (mesh.maxZ - mesh.minZ) * progress;

  const faces = mesh.triangles
    .map((triangle) =>
      clipAtLayer(triangle, threshold)
    )
    .filter(
      (polygon) => polygon.length >= 3
    )
    .map((polygon) => ({
      polygon,
      depth:
        polygon.reduce(
          (total, point) =>
            total + project(point)[2],
          0
        ) / polygon.length,
    }));

  faces.sort((a, b) => a.depth - b.depth);

  faces.forEach(({ polygon, depth }) => {
    const points = polygon.map(project);

    const shade = Math.max(
      42,
      Math.min(88, 62 + depth * 32)
    );

    context.fillStyle =
      `hsla(77, 100%, ${shade}%, .82)`;

    context.strokeStyle =
      'rgba(5,10,5,.18)';

    context.beginPath();

    context.moveTo(
      points[0][0],
      points[0][1]
    );

    points.slice(1).forEach((point) =>
      context.lineTo(
        point[0],
        point[1]
      )
    );

    context.closePath();
    context.fill();
    context.stroke();
  });

  // Orange print-head square and connecting line removed here.

  context.fillStyle = '#d8ff3e';

  context.fillRect(
    width * 0.12,
    height * 0.86,
    width * 0.76 * progress,
    3
  );

  context.fillStyle = '#d9ddd2';

  context.font =
    '10px DM Mono, monospace';

  context.fillText(
    `${partFiles[activePart].name.toUpperCase()}  ·  LAYER ${String(
      layerNumber
    ).padStart(3, '0')} / 150`,
    width * 0.12,
    height * 0.92
  );

  requestAnimationFrame(drawPrint);
}

partSelect?.addEventListener(
  'change',
  (event) => {
    activePart = Number(event.target.value);
    printStarted = performance.now();
  }
);

replayButton?.addEventListener(
  'click',
  () => {
    printStarted = performance.now();
  }
);

loadPrintFiles();