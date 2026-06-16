-- V0.16.4: allow contract approval templates to create document-scoped nodes.
-- submit_document() uses p_document_type as approval_nodes.scope_type for
-- non-timesheet templates, so PM/CC/PMCC contract routes need these scopes.

ALTER TABLE public.approval_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_nodes_scope;

ALTER TABLE public.approval_nodes
  ADD CONSTRAINT chk_approval_nodes_scope CHECK (
    (scope_type = 'project' AND scope_id IS NOT NULL)
    OR (
      scope_type = ANY (ARRAY[
        'timesheet',
        'department_summary',
        'contract',
        'contract_approval'
      ]::text[])
      AND scope_id IS NULL
    )
    OR scope_type IS NULL
  );
