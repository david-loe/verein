from __future__ import annotations

from typing import Any

import frappe

TARGET_CONFIG = {
	"Experience": {
		"link_field": "experience",
		"table_field": "experiences",
	},
	"Network": {
		"link_field": "network",
		"table_field": "networks",
	},
}


def get_target_config(target_doctype: str) -> dict[str, str]:
	config = TARGET_CONFIG.get(target_doctype)
	if not config:
		frappe.throw(f"Unsupported target doctype: {target_doctype}")
	return config


def normalize_supporter_names(supporter_names: list[str] | str) -> list[str]:
	if isinstance(supporter_names, str):
		supporter_names = frappe.parse_json(supporter_names)

	return [name for name in dict.fromkeys(supporter_names or []) if name]


def get_linked_supporters_for_target(target_doctype: str, target_name: str) -> list[dict[str, Any]]:
	config = get_target_config(target_doctype)
	rows = frappe.get_all(
		f"Supporter {target_doctype}",
		filters={config["link_field"]: target_name},
		fields=["parent", "note"],
		order_by="parent asc",
	)
	if not rows:
		return []

	notes_by_supporter = {}
	for row in rows:
		notes_by_supporter.setdefault(row.parent, row.note)

	supporter_names = list(notes_by_supporter)
	supporters = frappe.get_all(
		"Supporter",
		filters={"name": ["in", supporter_names]},
		fields=["name", "full_name", "email_address", "phone", "city"],
		limit=max(len(supporter_names), 20),
		order_by="full_name asc",
	)
	supporters_by_name = {supporter.name: supporter for supporter in supporters}

	linked_supporters = []
	for supporter_name in supporter_names:
		supporter = supporters_by_name.get(supporter_name)
		if not supporter:
			continue
		linked_supporters.append(
			{
				"name": supporter.name,
				"full_name": supporter.full_name,
				"email_address": supporter.email_address,
				"phone": supporter.phone,
				"city": supporter.city,
				"note": notes_by_supporter.get(supporter_name),
			}
		)

	return linked_supporters


def add_supporters_to_target(
	target_doctype: str, target_name: str, supporter_names: list[str] | str
) -> list[dict[str, Any]]:
	config = get_target_config(target_doctype)
	names = normalize_supporter_names(supporter_names)
	if not names:
		return get_linked_supporters_for_target(target_doctype, target_name)

	frappe.get_doc(target_doctype, target_name)

	for supporter_name in names:
		supporter = frappe.get_doc("Supporter", supporter_name)
		if any(row.get(config["link_field"]) == target_name for row in supporter.get(config["table_field"])):
			continue

		supporter.append(config["table_field"], {config["link_field"]: target_name})
		supporter.save(ignore_permissions=True)

	return get_linked_supporters_for_target(target_doctype, target_name)


def remove_supporter_from_target(
	target_doctype: str, target_name: str, supporter_name: str
) -> list[dict[str, Any]]:
	config = get_target_config(target_doctype)
	supporter = frappe.get_doc("Supporter", supporter_name)

	remaining_rows = [
		row
		for row in supporter.get(config["table_field"])
		if row.get(config["link_field"]) != target_name
	]
	if len(remaining_rows) != len(supporter.get(config["table_field"])):
		supporter.set(config["table_field"], remaining_rows)
		supporter.save(ignore_permissions=True)

	return get_linked_supporters_for_target(target_doctype, target_name)
