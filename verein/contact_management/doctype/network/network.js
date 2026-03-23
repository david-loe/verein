frappe.ui.form.on("Network", {
	refresh(frm) {
		render_linked_supporters(frm);
		render_geo_map_preview(frm);

		if (!frm.is_new()) {
			frm.add_custom_button(__("Add Supporter"), () => open_add_supporters_dialog(frm));
		}
	},
});

function render_linked_supporters(frm) {
	const field = frm.get_field("linked_supporters_html");
	if (!field) {
		return;
	}

	const wrapper = field.$wrapper;
	if (frm.is_new()) {
		wrapper.html(`<p class="text-muted">${__("Please save first.")}</p>`);
		return;
	}

	wrapper.html(`<p class="text-muted">${__("Loading linked supporters...")}</p>`);
	frappe.call({
		method: "verein.contact_management.doctype.network.network.get_linked_supporters",
		args: { network: frm.doc.name },
		callback: ({ message }) => {
			wrapper.html(get_supporters_table(message || []));
			bind_remove_events(frm, wrapper);
		},
	});
}

function bind_remove_events(frm, wrapper) {
	wrapper.off("click", ".remove-supporter");
	wrapper.on("click", ".remove-supporter", function () {
		const supporterName = $(this).data("supporter");
		frappe.confirm(__("Remove supporter link?"), () => {
			frappe.call({
				method: "verein.contact_management.doctype.network.network.remove_supporter",
				args: {
					network: frm.doc.name,
					supporter_name: supporterName,
				},
				callback: () => render_linked_supporters(frm),
			});
		});
	});
}

function get_supporters_table(supporters) {
	if (!supporters.length) {
		return `<p class="text-muted">${__("No linked supporters yet.")}</p>`;
	}

	const rows = supporters
		.map((supporter) => {
			const details = [supporter.email_address, supporter.phone, supporter.city]
				.filter(Boolean)
				.map((value) => frappe.utils.escape_html(value))
				.join(" · ");
			const note = supporter.note
				? `<div class="small text-muted mt-1">${frappe.utils.escape_html(supporter.note)}</div>`
				: "";

			return `
				<tr>
					<td>
						<a href="/app/supporter/${encodeURIComponent(supporter.name)}">
							${frappe.utils.escape_html(supporter.full_name || supporter.name)}
						</a>
						${details ? `<div class="small text-muted mt-1">${details}</div>` : ""}
						${note}
					</td>
					<td class="text-end" style="width: 1%;">
						<button class="btn btn-xs btn-secondary remove-supporter" data-supporter="${frappe.utils.escape_html(supporter.name)}">
							${__("Remove")}
						</button>
					</td>
				</tr>`;
		})
		.join("");

	return `<div class="table-responsive"><table class="table table-hover"><tbody>${rows}</tbody></table></div>`;
}

function open_add_supporters_dialog(frm) {
	const dialog = new frappe.ui.form.MultiSelectDialog({
		doctype: "Supporter",
		target: frm,
		columns: ["full_name", "city", "date_of_birth", "name"],
		setters: {
			full_name: null,
			city: null,
			date_of_birth: null,
		},
		get_query() {
			return {
				query: "verein.contact_management.doctype.supporter.supporter.supporter_picker_query",
			};
		},
		add_filters_group: 1,
		action(selections) {
			if (!selections.length) {
				frappe.msgprint(__("Please select at least one supporter."));
				return;
			}

			frappe.call({
				method: "verein.contact_management.doctype.network.network.add_supporters",
				args: {
					network: frm.doc.name,
					supporter_names: selections,
				},
				callback: () => render_linked_supporters(frm),
			});
		},
	});

	customize_supporter_picker_dialog(dialog);
}

function has_geo_coordinates(doc) {
	return doc.latitude != null && doc.longitude != null;
}

function render_geo_map_preview(frm) {
	const field = frm.get_field("geo_map_preview");
	if (!field) {
		return;
	}

	ensure_geo_map_preview_styles();
	const wrapper = field.$wrapper;
	destroy_geo_map(wrapper);

	if (!has_geo_coordinates(frm.doc)) {
		wrapper.empty();
		return;
	}

	const mapId = `network-geo-map-${frappe.utils.get_random(10)}`;
	wrapper.html(`<div class="geo-doc-preview-map" id="${mapId}"></div>`);

	const map = L.map(mapId, {
		scrollWheelZoom: false,
		attributionControl: true,
	});
	L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		attribution: "&copy; OpenStreetMap contributors",
		maxZoom: 19,
	}).addTo(map);

	const latLng = [frm.doc.latitude, frm.doc.longitude];
	L.marker(latLng).addTo(map);
	map.setView(latLng, 13);
	wrapper.data("geoPreviewMap", map);

	setTimeout(() => map.invalidateSize(), 0);
}

function destroy_geo_map(wrapper) {
	const map = wrapper.data("geoPreviewMap");
	if (map) {
		map.remove();
		wrapper.removeData("geoPreviewMap");
	}
}

function ensure_geo_map_preview_styles() {
	if (document.getElementById("geo-doc-preview-styles")) {
		return;
	}

	$(`<style id="geo-doc-preview-styles">
		.geo-doc-preview-map {
			width: 100%;
			min-height: 280px;
			border-radius: var(--border-radius-md);
			overflow: hidden;
			border: 1px solid var(--border-color);
		}
	</style>`).appendTo(document.head);
}

function customize_supporter_picker_dialog(picker) {
	frappe.after_ajax(() => {
		const dialog = picker.dialog;
		if (!dialog) {
			return;
		}

		const searchField = dialog.fields_dict.search_term;
		if (searchField) {
			searchField.df.label = __("ID");
			searchField.refresh();
		}

		const $body = $(dialog.body);
		const $searchWrapper = $body.find('.frappe-control[data-fieldname="search_term"]');
		const $cityWrapper = $body.find('.frappe-control[data-fieldname="city"]');
		if ($searchWrapper.length && $cityWrapper.length) {
			$searchWrapper.insertAfter($cityWrapper);
		}
	});
}
