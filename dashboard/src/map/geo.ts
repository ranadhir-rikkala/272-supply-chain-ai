import { geoAlbersUsa, geoPath } from "d3-geo";
import type { FeatureCollection, MultiLineString } from "geojson";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import statesTopology from "us-atlas/states-10m.json";

export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 600;

const topology = statesTopology as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;
const states = feature(topology, topology.objects.states) as unknown as FeatureCollection;
const borders = mesh(topology, topology.objects.states, (a, b) => a !== b) as MultiLineString;
const nation = mesh(topology, topology.objects.nation) as MultiLineString;

export const projection = geoAlbersUsa().fitExtent(
  [
    [16, 16],
    [MAP_WIDTH - 16, MAP_HEIGHT - 16],
  ],
  states,
);

const path = geoPath(projection);

export const STATE_PATHS = states.features.map((f, index) => ({ id: String(f.id ?? index), d: path(f) ?? "" }));
export const BORDER_PATH = path(borders) ?? "";
export const NATION_PATH = path(nation) ?? "";

export function project(longitude: number, latitude: number): [number, number] | null {
  return projection([longitude, latitude]) ?? null;
}

export function arcPath(cx: number, cy: number, radius: number, inner: number, start: number, end: number): string {
  const sweep = end - start;
  if (sweep <= 0) return "";
  if (sweep >= Math.PI * 2 - 1e-6) {
    return [
      `M ${cx + radius} ${cy}`,
      `A ${radius} ${radius} 0 1 1 ${cx - radius} ${cy}`,
      `A ${radius} ${radius} 0 1 1 ${cx + radius} ${cy}`,
      `M ${cx + inner} ${cy}`,
      `A ${inner} ${inner} 0 1 0 ${cx - inner} ${cy}`,
      `A ${inner} ${inner} 0 1 0 ${cx + inner} ${cy}`,
      "Z",
    ].join(" ");
  }
  const large = sweep > Math.PI ? 1 : 0;
  const point = (r: number, angle: number) => [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
  const [x0, y0] = point(radius, start);
  const [x1, y1] = point(radius, end);
  const [x2, y2] = point(inner, end);
  const [x3, y3] = point(inner, start);
  return `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`;
}
