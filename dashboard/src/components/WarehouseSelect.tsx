import { useQuery } from "@tanstack/react-query";
import { api } from "../api/endpoints";

interface Props {
  id: string;
  value: string;
  onChange: (warehouseId: string) => void;
}

/** Warehouse filter whose options come from the API, so they always match the loaded data. */
export function WarehouseSelect({ id, value, onChange }: Props) {
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: ({ signal }) => api.warehouses(signal) });
  const options = [...(warehouses.data ?? [])].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId));
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All warehouses</option>
      {options.map((w) => (
        <option key={w.warehouseId} value={w.warehouseId}>
          {w.city ? `${w.warehouseId} · ${w.city}` : w.warehouseId}
        </option>
      ))}
    </select>
  );
}
