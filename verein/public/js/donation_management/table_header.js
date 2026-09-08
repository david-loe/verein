// Keep the original header interactive while its table scrolls horizontally.
export class DonationTableHeader {
	constructor(shell) {
		this.shell = shell;
		this.pageContainer = shell.closest(".page-container");
		this.pageHead = this.pageContainer?.querySelector(".page-head");
		this.scrollContainer = shell.closest(".main-section") || document.scrollingElement;
		this.scrollTarget =
			this.scrollContainer === document.scrollingElement ? window : this.scrollContainer;
		this.offset = 0;
		this.schedule = () => {
			if (this.frame) return;
			this.frame = requestAnimationFrame(() => {
				this.frame = null;
				this.update();
			});
		};
		this.resizeObserver = new ResizeObserver(this.schedule);
		for (const element of new Set([
			shell,
			this.pageContainer,
			this.pageHead,
			this.scrollContainer,
		])) {
			if (element) this.resizeObserver.observe(element);
		}
		// The monthly overview replaces the table on every data refresh.
		this.mutationObserver = new MutationObserver(() => this.bind_table());
		this.mutationObserver.observe(shell, { childList: true });
		this.scrollTarget.addEventListener("scroll", this.schedule, { passive: true });
		window.addEventListener("resize", this.schedule);
		this.bind_table();
	}

	bind_table() {
		const table = this.shell.querySelector(":scope > table");
		if (table !== this.table) {
			if (this.table) this.resizeObserver.unobserve(this.table);
			if (this.head) {
				this.resizeObserver.unobserve(this.head);
				this.head.style.transform = "";
			}
			this.table = table;
			this.head = table?.tHead;
			this.offset = 0;
			if (this.table) this.resizeObserver.observe(this.table);
			if (this.head) this.resizeObserver.observe(this.head);
		}
		this.schedule();
	}

	update() {
		if (!this.shell.isConnected) {
			this.destroy();
			return;
		}
		if (!this.head || !this.shell.getClientRects().length) return;

		const tableRect = this.table.getBoundingClientRect();
		const headRect = this.head.getBoundingClientRect();
		const naturalTop = headRect.top - this.offset;
		const scrollTop =
			this.scrollTarget === window ? 0 : this.scrollContainer.getBoundingClientRect().top;
		const pageHeadRect = this.pageHead?.getBoundingClientRect();
		const top = Math.max(scrollTop, pageHeadRect?.height ? pageHeadRect.bottom : scrollTop);
		const maxOffset = Math.max(0, tableRect.bottom - naturalTop - headRect.height);
		const offset = Math.min(maxOffset, Math.max(0, top - naturalTop));
		if (Math.abs(offset - this.offset) < 0.01) return;
		this.offset = offset;
		this.head.style.transform = offset ? `translateY(${offset}px)` : "";
	}

	destroy() {
		cancelAnimationFrame(this.frame);
		this.resizeObserver.disconnect();
		this.mutationObserver.disconnect();
		this.scrollTarget.removeEventListener("scroll", this.schedule);
		window.removeEventListener("resize", this.schedule);
		if (this.head) this.head.style.transform = "";
	}
}
