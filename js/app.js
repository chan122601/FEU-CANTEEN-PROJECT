    const SESSION_KEY = "feuCanteenSession";

    const CANTEEN_PRODUCTS_KEY = "feuCanteenInventory";
    let existingCanteenProducts = [];
    try { existingCanteenProducts = JSON.parse(localStorage.getItem(CANTEEN_PRODUCTS_KEY) || "[]"); } catch (error) { existingCanteenProducts = []; }
    if (!Array.isArray(existingCanteenProducts) || existingCanteenProducts.length === 0) {
        localStorage.setItem(CANTEEN_PRODUCTS_KEY, JSON.stringify([
            {id:1,name:"Chicken Rice Meal",category:"Meals",price:85,stock:18,size:"Regular",color:"Fresh",image: "\u{1F35B}"},
            {id:2,name:"Pork Adobo Rice",category:"Meals",price:75,stock:16,size:"Regular",color:"Fresh",image: "\u{1F372}"},
            {id:3,name:"Fried Chicken Rice",category:"Meals",price:80,stock:12,size:"Regular",color:"Fresh",image: "\u{1F357}"},
            {id:4,name:"Siomai Rice",category:"Meals",price:65,stock:20,size:"Regular",color:"Fresh",image: "\u{1F95F}"},
            {id:5,name:"French Fries",category:"Snacks",price:45,stock:20,size:"Regular",color:"Fresh",image: "\u{1F35F}"},
            {id:6,name:"Siomai",category:"Snacks",price:40,stock:24,size:"Regular",color:"Fresh",image: "\u{1F95F}"},
            {id:7,name:"Sandwich",category:"Snacks",price:50,stock:15,size:"Regular",color:"Fresh",image: "\u{1F96A}"},
            {id:8,name:"Burger",category:"Snacks",price:55,stock:10,size:"Regular",color:"Fresh",image: "\u{1F354}"},
            {id:9,name:"Bottled Water",category:"Drinks",price:20,stock:35,size:"Regular",color:"Fresh",image: "\u{1F4A7}"},
            {id:10,name:"Soft Drink",category:"Drinks",price:30,stock:24,size:"Regular",color:"Fresh",image: "\u{1F964}"},
            {id:11,name:"Iced Tea",category:"Drinks",price:35,stock:18,size:"Regular",color:"Fresh",image: "\u{1F9CB}"},
            {id:12,name:"Iced Coffee",category:"Coffee",price:55,stock:7,size:"Regular",color:"Fresh",image: "\u{2615}"},
            {id:13,name:"Chocolate Cake",category:"Desserts",price:60,stock:9,size:"Regular",color:"Fresh",image: "\u{1F370}"},
            {id:14,name:"Banana Bread",category:"Desserts",price:45,stock:12,size:"Regular",color:"Fresh",image: "\u{1F35E}"},
            {id:15,name:"Donut",category:"Desserts",price:35,stock:16,size:"Regular",color:"Fresh",image: "\u{1F369}"}
        ]));
    }

    const currentPage =
        window.location.pathname
            .split("/")
            .pop()
            .toLowerCase();

    let currentSession = null;

    const savedSession =
        localStorage.getItem(
            SESSION_KEY
        );

    if (savedSession) {
        try {
            currentSession =
                JSON.parse(
                    savedSession
                );
        } catch (error) {
            currentSession = null;
        }
    }

    const staffAllowedPages = [
        "index.html",
        "pos.html",
        "sales.html",
        "customers.html"
    ];

    const adminOnlyPages = ["products.html", "inventory.html", "reports.html", "customers.html", "settings.html", "account.html"];

    if (
        currentPage !== "login.html"
    ) {

        if (!currentSession) {

            const loginPath =
                window.location.pathname.includes("/pages/")
                    ? "login.html"
                    : "pages/login.html";

            window.location.href =
                loginPath;
        }

        if (
            currentSession &&
            String(
                currentSession.role || ""
            ).toLowerCase() === "staff"
        ) {

            if (
                adminOnlyPages.includes(
                    currentPage
                )
            ) {

                window.location.href =
                    "../index.html";
            }
        }
    }

    document.addEventListener(
        "DOMContentLoaded",
        function() {



            updateClock();

            setInterval(
                updateClock,
                1000
            );

            loadDashboard();

            setupUserSession();

            setupMobileNavigation();

            setupAvatarMotion();

        }
    );

    function setupAvatarMotion() {
        document.querySelectorAll(".profile-avatar").forEach(function(avatar) {
            avatar.addEventListener("click", function(event) {
                if (typeof avatar.animate === "function") {
                    avatar.animate(
                        [
                            { transform: "scale(1) rotate(0deg)" },
                            { transform: "scale(1.08) rotate(-3deg)", offset: 0.45 },
                            { transform: "scale(1.04) rotate(2deg)", offset: 0.72 },
                            { transform: "scale(1) rotate(0deg)" }
                        ],
                        {
                            duration: 260,
                            easing: "cubic-bezier(.2,.75,.25,1)"
                        }
                    );
                }
            });
        });
    }

    function setupMobileNavigation() {
        const sidebar = document.querySelector(".sidebar");
        const topbar = document.querySelector(".topbar");

        if (!sidebar || !topbar || document.getElementById("mobileMenuButton")) {
            return;
        }

        const menuButton = document.createElement("button");
        menuButton.id = "mobileMenuButton";
        menuButton.type = "button";
        menuButton.className = "mobile-menu-button";
        menuButton.setAttribute("aria-label", "Open navigation menu");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.innerHTML = "<span></span><span></span><span></span>";

        const overlay = document.createElement("button");
        overlay.type = "button";
        overlay.className = "mobile-nav-overlay";
        overlay.setAttribute("aria-label", "Close navigation menu");

        function closeMenu() {
            document.body.classList.remove("mobile-nav-open");
            menuButton.setAttribute("aria-expanded", "false");
        }

        menuButton.addEventListener("click", function() {
            const open = document.body.classList.toggle("mobile-nav-open");
            menuButton.setAttribute("aria-expanded", String(open));
        });

        overlay.addEventListener("click", closeMenu);
        sidebar.querySelectorAll("a").forEach(function(link) {
            link.addEventListener("click", closeMenu);
        });

        topbar.insertBefore(menuButton, topbar.firstChild);
        document.body.appendChild(overlay);
    }

    function setupUserSession() {

        const session =
            localStorage.getItem(
                SESSION_KEY
            );

        if (!session) {
            return;
        }

        let user;

        try {
            user =
                JSON.parse(
                    session
                );
        } catch (error) {
            return;
        }

        const profile =
            document.querySelector(
                ".profile"
            );

        if (profile) {

            const name =
                profile.querySelector(
                    "strong"
                );

            const role =
                profile.querySelector(
                    ".profile-info span"
                );

            if (name) {

                name.textContent =
                    user.name ||
                    user.username ||
                    "User";
            }

            if (role) {

                role.textContent =
                    String(
                        user.role || ""
                    ).toLowerCase() ===
                    "administrator"
                        ? "Owner"
                        : "Staff";
            }

            setupProfileDropdown(profile, user);
        }

        createLogoutButton(
            user
        );

        applyRolePermissions(
            user.role
        );
    }

    function setupProfileDropdown(profile, user) {
        if (profile.dataset.accountDropdownReady === "true") {
            return;
        }

        const isAdministrator = String(user.role || "").toLowerCase() === "administrator";
        const dropdown = document.createElement("div");
        const identity = document.createElement("div");
        const name = document.createElement("strong");
        const role = document.createElement("span");

        dropdown.id = "accountDropdown";
        dropdown.className = "profile-dropdown";
        dropdown.setAttribute("role", "menu");
        identity.className = "profile-dropdown-identity";
        name.textContent = user.name || user.username || "User";
        role.textContent = isAdministrator ? "Owner" : "Staff";
        identity.append(name, role);
        dropdown.appendChild(identity);

        if (isAdministrator) {
            const accountLink = document.createElement("a");
            accountLink.href = window.location.pathname.includes("/pages/")
                ? "account.html"
                : "pages/account.html";
            accountLink.setAttribute("role", "menuitem");
            accountLink.textContent = "Account Management";
            dropdown.appendChild(accountLink);
        }

        document.body.appendChild(dropdown);
        profile.dataset.accountDropdownReady = "true";
        profile.style.cursor = "pointer";
        profile.setAttribute("role", "button");
        profile.setAttribute("tabindex", "0");
        profile.setAttribute("aria-haspopup", "menu");
        profile.setAttribute("aria-controls", dropdown.id);
        profile.setAttribute("aria-expanded", "false");

        function setOpen(open) {
            profile.setAttribute("aria-expanded", String(open));
            dropdown.classList.toggle("open", open);

            if (open) {
                const bounds = profile.getBoundingClientRect();
                dropdown.style.top = Math.round(bounds.bottom + 8) + "px";
                dropdown.style.right = Math.max(8, window.innerWidth - bounds.right) + "px";
            }
        }

        profile.addEventListener("click", function() {
            setOpen(profile.getAttribute("aria-expanded") !== "true");
        });

        profile.addEventListener("keydown", function(event) {
            if (event.key === "Escape") {
                setOpen(false);
                return;
            }

            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen(profile.getAttribute("aria-expanded") !== "true");
            }
        });

        dropdown.addEventListener("keydown", function(event) {
            if (event.key === "Escape") {
                setOpen(false);
                profile.focus();
            }
        });

        document.addEventListener("click", function(event) {
            if (!profile.contains(event.target) && !dropdown.contains(event.target)) {
                setOpen(false);
            }
        });

        window.addEventListener("resize", function() {
            if (profile.getAttribute("aria-expanded") === "true") {
                setOpen(true);
            }
        });

        window.addEventListener("scroll", function() {
            setOpen(false);
        }, true);
    }

    function createLogoutButton(
        user
    ) {

        const topbarRight =
            document.querySelector(
                ".topbar-right"
            );

        if (
            !topbarRight ||
            document.getElementById(
                "globalLogoutButton"
            )
        ) {
            return;
        }

        const logoutButton =
            document.createElement(
                "button"
            );

        logoutButton.id =
            "globalLogoutButton";

        logoutButton.type =
            "button";

        logoutButton.innerHTML =
            '<svg class="logout-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4"/><path d="M11 6l4 4-4 4M15 10H7"/></svg><span>Logout</span>';

        logoutButton.addEventListener(
            "click",
            function() {

                const confirmed =
                    confirm(
                        "Are you sure you want to logout?"
                    );

                if (!confirmed) {
                    return;
                }

                localStorage.removeItem(
                    SESSION_KEY
                );

                const loginPath =
                    window.location.pathname.includes("/pages/")
                        ? "login.html"
                        : "pages/login.html";

                window.location.href =
                    loginPath;

            }
        );

        topbarRight.appendChild(
            logoutButton
        );
    }

    function applyRolePermissions(
        role
    ) {

        const normalizedRole =
            String(
                role || ""
            ).toLowerCase();

        const restrictedPages = ["products.html", "inventory.html", "reports.html", "customers.html", "settings.html", "account.html"];

        if (
            normalizedRole !== "staff"
        ) {
            return;
        }

        document
            .querySelectorAll(
                ".nav-item"
            )
            .forEach(
                function(link) {

                    const href =
                        link.getAttribute(
                            "href"
                        );

                    if (!href) {
                        return;
                    }

                    const page =
                        href
                            .split("/")
                            .pop()
                            .toLowerCase();

                    if (
                        restrictedPages.includes(
                            page
                        )
                    ) {

                        link.style.display =
                            "none";
                    }
                }
            );

        document
            .querySelectorAll(
                'a[href*="products.html"]'
            )
            .forEach(
                function(link) {

                    link.style.display =
                        "none";
                }
            );

        document
            .querySelectorAll(
                'a[href*="inventory.html"]'
            )
            .forEach(
                function(link) {

                    link.style.display =
                        "none";
                }
            );

        document.querySelectorAll('a[href*="customers.html"]').forEach(function(link) { link.style.display = "none"; });
        document.querySelectorAll('a[href*="reports.html"]')
            .forEach(
                function(link) {

                    link.style.display =
                        "none";
                }
            );

        document
            .querySelectorAll(
                'a[href*="settings.html"]'
            )
            .forEach(
                function(link) {

                    link.style.display =
                        "none";
                }
            );
    }

    function updateClock() {

        const clock =
            document.getElementById(
                "liveTime"
            );

        if (!clock) {
            return;
        }

        const now =
            new Date();

        clock.textContent =
            now.toLocaleTimeString(
                undefined,
                {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: true
                }
            );

        const liveTime =
            clock.closest(".live-time");

        if (liveTime) {
            let date =
                liveTime.querySelector(".live-date");

            if (!date) {
                date = document.createElement("span");
                date.className = "live-date";
                liveTime.appendChild(date);
            }

            date.textContent =
                now.toLocaleDateString(
                    undefined,
                    {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                    }
                );
        }
    }

    function loadDashboard() {

        if (!document.querySelector(".dashboard")) {
            return;
        }

        const sales =
            JSON.parse(
                localStorage.getItem(
                    "feuCanteenSales"
                )
            ) || [];

        const inventory =
            JSON.parse(
                localStorage.getItem(
                    "feuCanteenInventory"
                )
            ) || {};

        updateSalesStats(
            sales
        );

        updateProductStats(
            inventory
        );

        updateRecentTransactions(
            sales
        );

        updateStockStatus(
            inventory
        );
    }

    function updateSalesStats(
        sales
    ) {

        const today =
            new Date()
                .toLocaleDateString(
                    "en-US"
                );

        let todaySales = 0;

        let transactions = 0;

        sales.forEach(
            function(sale) {

                if (
                    sale.date ===
                    today
                ) {

                    todaySales +=
                        Number(
                            sale.total
                        ) || 0;

                    transactions++;
                }
            }
        );

        animateNumber(
            "todaySales",
            todaySales
        );

        animateNumber(
            "transactionCount",
            transactions
        );
    }

    function updateProductStats(
        inventory
    ) {

        let products = 0;

        let lowStock = 0;

        if (
            Array.isArray(
                inventory
            )
        ) {

            products =
                inventory.length;

            inventory.forEach(
                function(item) {

                    if (
                        Number(
                            item.stock
                        ) <= 5
                    ) {

                        lowStock++;
                    }
                }
            );

        } else if (
            inventory &&
            typeof inventory ===
                "object"
        ) {

            products =
                Object.keys(
                    inventory
                ).length;

            Object.values(
                inventory
            ).forEach(
                function(item) {

                    if (
                        item &&
                        Number(
                            item.stock
                        ) <= 5
                    ) {

                        lowStock++;
                    }
                }
            );
        }

        animateNumber(
            "productCount",
            products
        );

        animateNumber(
            "lowStockCount",
            lowStock
        );
    }

    function animateNumber(
        elementId,
        target
    ) {

        const element =
            document.getElementById(
                elementId
            );

        if (!element) {
            return;
        }

        const duration =
            700;

        const start =
            performance.now();

        function update(
            currentTime
        ) {

            const progress =
                Math.min(
                    (
                        currentTime -
                        start
                    ) /
                    duration,
                    1
                );

            const value =
                Math.floor(
                    target *
                    progress
                );

            element.textContent =
                value.toLocaleString(
                    "en-PH"
                );

            if (
                progress < 1
            ) {

                requestAnimationFrame(
                    update
                );
            }
        }

        requestAnimationFrame(
            update
        );
    }

    function updateRecentTransactions(
        sales
    ) {

        const container =
            document.getElementById(
                "recentTransactions"
            );

        if (!container) {
            return;
        }

        if (
            sales.length === 0
        ) {
            return;
        }

        container.innerHTML =
            "";

        sales
            .slice(0, 5)
            .forEach(
                function(sale) {

                    const item =
                        document.createElement(
                            "div"
                        );

                    item.className =
                        "transaction";

                    item.innerHTML = `
                        <div class="transaction-icon">&#129534;</div>

                        <div class="transaction-info">
                            <strong>${escapeHTML(sale.transaction || "Transaction")}</strong>
                            <span>${escapeHTML((sale.items || []).map(function(product) { return product.name; }).filter(Boolean).join(" + ") || sale.date || "Food order")}</span>
                            <span>${escapeHTML(sale.date || "")}</span>
                        </div>

                        <div class="transaction-total">
                            ₱${Number(
                                sale.total ||
                                0
                            ).toLocaleString(
                                "en-PH",
                                {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                }
                            )}
                        </div>
                    `;

                    container.appendChild(
                        item
                    );
                }
            );
    }

    function updateStockStatus(
        inventory
    ) {

        const container =
            document.getElementById(
                "stockStatus"
            );

        if (!container) {
            return;
        }

        let items = [];

        if (
            Array.isArray(
                inventory
            )
        ) {

            items =
                inventory;

        } else if (
            inventory &&
            typeof inventory ===
                "object"
        ) {

            items =
                Object.keys(
                    inventory
                ).map(
                    function(name) {

                        return {
                            name:
                                name,
                            ...inventory[
                                name
                            ]
                        };
                    }
                );
        }

        if (
            items.length === 0
        ) {
            return;
        }

        container.innerHTML =
            "";

        items
            .slice(0, 5)
            .forEach(
                function(item) {

                    const stock =
                        Number(
                            item.stock
                        ) || 0;

                    const row =
                        document.createElement(
                            "div"
                        );

                    const statusClass = stock <= 3 ? "critical" : stock <= 10 ? "low" : "good";
                    row.className = "stock-item " + statusClass;

                    row.innerHTML = `
                        <div class="stock-image" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.7"/><circle cx="12" cy="12" r="5.2"/><path d="M3 3v5m-1.5-5v3M4.5 3v3M3 8v13M20 3c-2 2-2.5 5-2.5 8h3V3zm0 8v10"/></svg></div>

                        <div class="stock-info">
                            <strong>
                                ${escapeHTML(
                                    item.name ||
                                    "Product"
                                )}
                            </strong>

                            <span>Food product</span>
                            <div class="stock-meter"><span style="width:${Math.min(100, stock / 35 * 100)}%"></span></div>
                        </div>

                        <div class="stock-number ${statusClass}">
                            ${stock} left
                        </div>
                    `;

                    container.appendChild(
                        row
                    );
                }
            );
    }

    function escapeHTML(
        value
    ) {

        return String(
            value ?? ""
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }
