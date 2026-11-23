$(function () {
  "use strict";

  const DNS_TYPES = ["A", "AAAA", "MX", "NS", "TXT"];
  const STORAGE_KEY = "domainCheckerState";
  const $form = $("#domain-form");
  const $domainInput = $("#domain-input");
  const $checkButton = $("#check-button");
  const $errorMessage = $("#error-message");
  const $loadingState = $("#loading-state");
  const $results = $("#results");

  /**
   * Entfernt Protokoll und Pfad, damit auch kopierte URLs geprüft werden können.
   * Die URL-Klasse wandelt internationale Domains automatisch in Punycode um.
   */
  function normalizeDomain(value) {
    const trimmedValue = value.trim().toLowerCase();

    if (!trimmedValue) {
      return "";
    }

    try {
      const url = new URL(
        trimmedValue.includes("://") ? trimmedValue : `https://${trimmedValue}`,
      );

      return url.hostname.replace(/\.$/, "");
    } catch (error) {
      return "";
    }
  }

  function isValidDomain(domain) {
    const labels = domain.split(".");

    if (domain.length > 253 || labels.length < 2) {
      return false;
    }

    return labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
    );
  }

  function setLoading(isLoading) {
    $checkButton.prop("disabled", isLoading).text(isLoading ? "Wird geprüft …" : "Prüfen");
    $loadingState.toggleClass("d-none", !isLoading);

    if (isLoading) {
      $results.addClass("d-none");
      hideMessage();
    }
  }

  function showMessage(message, type = "danger") {
    $errorMessage
      .removeClass("d-none alert-danger alert-warning")
      .addClass(`alert-${type}`)
      .text(message);
  }

  function hideMessage() {
    $errorMessage.addClass("d-none").text("");
  }

  function fetchDnsRecord(domain, type) {
    return Promise.resolve(
      $.ajax({
        url: "https://dns.google/resolve",
        data: { name: domain, type },
        dataType: "json",
        timeout: 10000,
      }),
    ).then((response) => ({ response, type }));
  }

  function loadState() {
    try {
      const savedState = JSON.parse(localStorage.getItem(STORAGE_KEY));

      return {
        lastDomain: savedState?.lastDomain || "",
        recentDomains: Array.isArray(savedState?.recentDomains) ? savedState.recentDomains : [],
      };
    } catch (error) {
      return { lastDomain: "", recentDomains: [] };
    }
  }

  function renderRecentSearches(state) {
    const $recentSearches = $("#recent-searches").empty();
    const hasRecentSearches = state.recentDomains.length > 0;

    $("#recent-searches-section").toggleClass("d-none", !hasRecentSearches);

    state.recentDomains.forEach((domain) => {
      $("<button>")
        .attr("type", "button")
        .addClass("btn btn-sm btn-outline-primary recent-search-button")
        .data("domain", domain)
        .text(domain)
        .appendTo($recentSearches);
    });
  }

  function saveSearch(domain) {
    const currentState = loadState();
    const recentDomains = [
      domain,
      ...currentState.recentDomains.filter((savedDomain) => savedDomain !== domain),
    ].slice(0, 5);
    const nextState = { lastDomain: domain, recentDomains };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      renderRecentSearches(nextState);
    } catch (error) {
      // Die Abfrage funktioniert auch, wenn WebStorage im Browser deaktiviert ist.
    }
  }

  async function fetchDnsRecords(domain) {
    const requests = DNS_TYPES.map((type) => fetchDnsRecord(domain, type));
    return Promise.allSettled(requests);
  }

  function formatRecordValue(value) {
    return String(value).replace(/\.$/, "");
  }

  function renderDnsRecords(settledRequests) {
    const $tableBody = $("#dns-results").empty();
    let recordCount = 0;

    settledRequests.forEach((request) => {
      if (request.status !== "fulfilled") {
        return;
      }

      const { response, type } = request.value;

      // Google liefert einzelne Einträge im Answer-Array zurück.
      (response.Answer || []).forEach((answer) => {
        const $row = $("<tr>");
        $("<td>").append($("<span>").addClass("badge text-bg-light border").text(type)).appendTo($row);
        $("<td>").addClass("dns-value").text(formatRecordValue(answer.data)).appendTo($row);
        $("<td>").text(`${answer.TTL} s`).appendTo($row);
        $tableBody.append($row);
        recordCount += 1;
      });
    });

    return recordCount;
  }

  function showResults(domain, settledRequests) {
    const failedRequests = settledRequests.filter((request) => request.status === "rejected");
    const recordCount = renderDnsRecords(settledRequests);

    if (failedRequests.length === settledRequests.length) {
      throw new Error("Die Google DNS API ist momentan nicht erreichbar. Bitte versuche es später erneut.");
    }

    if (recordCount === 0) {
      throw new Error("Für diese Domain wurden keine DNS-Einträge gefunden.");
    }

    saveSearch(domain);
    $("#result-domain").text(domain);
    $("#result-timestamp").text(
      `Geprüft am ${new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date())}`,
    );

    if (failedRequests.length > 0) {
      $("#dns-status")
        .removeClass("text-bg-success-subtle text-success-emphasis")
        .addClass("text-bg-warning-subtle text-warning-emphasis")
        .text("Teilweise geladen");
      showMessage("Einige DNS-Eintragstypen konnten nicht geladen werden.", "warning");
    } else {
      $("#dns-status")
        .removeClass("text-bg-warning-subtle text-warning-emphasis")
        .addClass("text-bg-success-subtle text-success-emphasis")
        .text("Erreichbar");
    }

    // fadeIn visualisiert, dass neue Daten im DOM eingesetzt wurden.
    $results.stop(true, true).hide().removeClass("d-none").fadeIn(250);
  }

  $domainInput.on("input", function () {
    $(this).removeClass("is-invalid");
    $("#domain-feedback").removeClass("d-block");
  });

  $form.on("submit", async function (event) {
    event.preventDefault();

    const domain = normalizeDomain($domainInput.val());

    if (!isValidDomain(domain)) {
      $results.addClass("d-none");
      hideMessage();
      $domainInput.addClass("is-invalid").trigger("focus");
      $("#domain-feedback").addClass("d-block");
      return;
    }

    $domainInput.val(domain).removeClass("is-invalid");
    setLoading(true);

    try {
      const dnsRequests = await fetchDnsRecords(domain);
      showResults(domain, dnsRequests);
    } catch (error) {
      showMessage(error.message);
    } finally {
      setLoading(false);
    }
  });

  $("#recent-searches").on("click", ".recent-search-button", function () {
    $domainInput.val($(this).data("domain"));
    $form.trigger("submit");
  });

  $("#clear-history-button").on("click", function () {
    localStorage.removeItem(STORAGE_KEY);
    renderRecentSearches({ lastDomain: "", recentDomains: [] });
  });

  const initialState = loadState();
  renderRecentSearches(initialState);

  if (initialState.lastDomain) {
    $domainInput.val(initialState.lastDomain);
    $form.trigger("submit");
  }
});
