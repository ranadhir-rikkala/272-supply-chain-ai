CREATE TABLE eval.disruption_truth (disruption_id text PRIMARY KEY, disruption_type text NOT NULL, start_date date NOT NULL, end_date date NOT NULL, description text NOT NULL, supplier_id text REFERENCES core.dim_supplier, sku text REFERENCES core.dim_product, warehouse_id text REFERENCES core.dim_warehouse);
CREATE TABLE eval.planted_defect (defect_id text PRIMARY KEY, file_key text NOT NULL, line_number bigint NOT NULL, defect_type text NOT NULL, expected_reason text NOT NULL);
CREATE OR REPLACE VIEW eval.v_quality_gate_check AS
SELECT p.defect_id, p.file_key, p.line_number, p.expected_reason, q.reason_code, (q.id IS NOT NULL) AS matched
FROM eval.planted_defect p LEFT JOIN ops.quarantine_row q ON q.file_key=p.file_key AND q.line_number=p.line_number AND q.reason_code=p.expected_reason;
