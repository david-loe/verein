from __future__ import annotations

from typing import Any

import frappe
from frappe.utils import cint

ACCESS_DOCTYPE = "Cost Center Access"
BUDGET_DOCTYPE = "Cost Center Budget"
PRIVILEGED_VIEW_ROLES = {"System Manager", "Accounts Manager", "Cost Center Manager"}
BUDGET_MANAGER_ROLES = {"System Manager", "Cost Center Manager"}
ACCESS_MANAGER_ROLES = {"System Manager", "Cost Center Manager"}


def user_has_any_role(user: str | None, roles: set[str]) -> bool:
	return bool(roles.intersection(frappe.get_roles(user)))


def can_view_all_cost_centers(user: str | None = None) -> bool:
	return user_has_any_role(user, PRIVILEGED_VIEW_ROLES)


def can_manage_access_records(user: str | None = None) -> bool:
	return user_has_any_role(user, ACCESS_MANAGER_ROLES)


def can_manage_all_budgets(user: str | None = None) -> bool:
	return user_has_any_role(user, BUDGET_MANAGER_ROLES)


def get_descendant_cost_centers(cost_center: str) -> list[str]:
	cost_center_doc = frappe.db.get_value(
		"Cost Center",
		cost_center,
		["name", "company", "is_group", "lft", "rgt"],
		as_dict=True,
	)
	if not cost_center_doc:
		return []

	if not cint(cost_center_doc.is_group):
		return [cost_center_doc.name]

	return frappe.get_all(
		"Cost Center",
		filters={
			"company": cost_center_doc.company,
			"lft": [">=", cost_center_doc.lft],
			"rgt": ["<=", cost_center_doc.rgt],
			"disabled": 0,
		},
		pluck="name",
		order_by="lft asc",
	)


def get_accessible_cost_center_names(user: str | None = None, access_level: str | None = None) -> list[str]:
	user = user or frappe.session.user
	if can_view_all_cost_centers(user) and not access_level:
		return frappe.get_all("Cost Center", filters={"disabled": 0}, pluck="name", order_by="lft asc")

	access_filters: dict[str, Any] = {"user": user, "active": 1}
	if access_level:
		access_filters["access_level"] = access_level

	access_rows = frappe.get_all(ACCESS_DOCTYPE, filters=access_filters, pluck="cost_center")
	allowed: set[str] = set()
	for cost_center in access_rows:
		allowed.update(get_descendant_cost_centers(cost_center))

	return sorted(allowed)


def has_cost_center_access(
	cost_center: str | None,
	user: str | None = None,
	access_level: str | None = None,
) -> bool:
	if not cost_center:
		return False

	user = user or frappe.session.user
	if access_level == "Manage":
		if can_manage_all_budgets(user):
			return True
	elif can_view_all_cost_centers(user):
		return True

	cost_center_doc = frappe.db.get_value(
		"Cost Center",
		cost_center,
		["name", "company", "lft", "rgt"],
		as_dict=True,
	)
	if not cost_center_doc:
		return False

	filters: dict[str, Any] = {"user": user, "active": 1}
	if access_level:
		filters["access_level"] = access_level

	for row in frappe.get_all(ACCESS_DOCTYPE, filters=filters, fields=["cost_center"]):
		access_cost_center = frappe.db.get_value(
			"Cost Center",
			row.cost_center,
			["company", "lft", "rgt"],
			as_dict=True,
		)
		if not access_cost_center or access_cost_center.company != cost_center_doc.company:
			continue
		if access_cost_center.lft <= cost_center_doc.lft and access_cost_center.rgt >= cost_center_doc.rgt:
			return True

	return False


def get_permission_query_conditions_for_access(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	if user == "Administrator" or can_manage_access_records(user):
		return None

	return f"`tabCost Center Access`.`user` = {frappe.db.escape(user)} and `tabCost Center Access`.`active` = 1"


def get_permission_query_conditions_for_budget(user: str | None = None) -> str | None:
	user = user or frappe.session.user
	if user == "Administrator" or can_manage_all_budgets(user):
		return None

	cost_centers = get_accessible_cost_center_names(user)
	if not cost_centers:
		return "1=0"

	escaped_cost_centers = ", ".join(frappe.db.escape(cost_center) for cost_center in cost_centers)
	return f"`tabCost Center Budget`.`cost_center` in ({escaped_cost_centers})"


def has_access_permission(doc, ptype: str, user: str | None = None, debug: bool = False) -> bool:
	user = user or frappe.session.user
	if user == "Administrator" or can_manage_access_records(user):
		return True

	if ptype in {"read", "select"}:
		return doc.user == user and cint(doc.active)

	return False


def has_budget_permission(doc, ptype: str, user: str | None = None, debug: bool = False) -> bool:
	user = user or frappe.session.user
	if user == "Administrator" or can_manage_all_budgets(user):
		return True

	if ptype in {"read", "select"}:
		return has_cost_center_access(doc.cost_center, user=user)

	if ptype in {"create", "write"}:
		return has_cost_center_access(doc.cost_center, user=user, access_level="Manage")

	return False
