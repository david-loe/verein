import frappe
from frappe.desk.doctype.sidebar.sidebar import ResolvedSidebar, resolve_sidebar
from frappe.utils.modules import is_module_visible


def has_app_permission() -> bool:
	"""Show Verein when the current user can navigate at least one of its modules."""
	return bool(get_app_sidebar())


def get_app_sidebar() -> ResolvedSidebar | None:
	"""Prefer donations, falling back to contacts when donations are inaccessible."""
	for module in ("Donation Management", "Contact Management"):
		if is_module_visible(module):
			sidebar = resolve_sidebar(module, frappe.session.user)
			if sidebar:
				return sidebar
	return None


@frappe.whitelist()
def open_app() -> None:
	"""Open the selected sidebar's first accessible destination in either desktop mode."""
	sidebar = get_app_sidebar()
	if not sidebar:
		raise frappe.PermissionError
	landing = sidebar.landing
	if not landing:
		# Frappe's server-side landing resolver leaves Page routes to the client.
		first_link = next((item for item in sidebar.items if item.get("type") == "Link"), None)
		if first_link and first_link.get("link_type") == "Page":
			landing = f"/desk/{first_link['link_to']}"
	frappe.local.response.type = "redirect"
	frappe.local.response.location = landing or "/desk"
