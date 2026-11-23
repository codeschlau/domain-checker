$(function () {
  "use strict";

  const DNS_TYPES = ["A", "AAAA", "MX", "NS", "TXT"];
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
});
