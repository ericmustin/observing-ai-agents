# LLM observability 101: run `make help` for the list of targets.
SHELL := /bin/bash
.DEFAULT_GOAL := help

-include .env
export

# docker or podman: Docker if it's installed, otherwise Podman. Set CONTAINER_ENGINE=podman in .env to choose.
CONTAINER_ENGINE ?= $(if $(shell command -v docker 2>/dev/null),docker,podman)
COMPOSE := $(CONTAINER_ENGINE) compose
# Hide Podman's "Executing external compose provider" banner on every command.
PODMAN_COMPOSE_WARNING_LOGS ?= false
# Podman's file sharing doesn't pass file-change events into containers, so Lab 3's hot reload polls instead.
ifeq ($(CONTAINER_ENGINE),podman)
WATCHPACK_POLLING ?= true
endif

KIBANA_URL := http://localhost:$(or $(KIBANA_PORT),5601)
APP_URL := http://localhost:$(or $(APP_PORT),3000)
ES_AUTH := elastic:$(or $(ELASTIC_PASSWORD),changeme)

.PHONY: help prep up down reset doctor traffic collector-restart solution lab-reset semconv legacy logs urls export warm

help: ## Show this help
	@awk -F':.*## ' '/^[a-z-]+:.*## / {printf "  \033[36mmake %-18s\033[0m %s\n", $$1, $$2}' Makefile

prep: ## One-time: create .env, pull and build images (do this before the workshop)
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example")
	$(COMPOSE) pull --ignore-buildable --quiet
	$(COMPOSE) build

up: ## Start everything and wait until it's healthy (2-3 minutes)
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example")
	$(COMPOSE) up -d --wait --wait-timeout 600
	@# --wait doesn't wait for one-shot containers: make sure the dashboards and the rule are loaded.
	@$(COMPOSE) wait kibana-setup >/dev/null || { echo "kibana-setup failed: $(COMPOSE) logs kibana-setup"; exit 1; }
	@$(MAKE) --no-print-directory warm
	@$(MAKE) --no-print-directory urls

down: ## Stop everything (keeps your data)
	$(COMPOSE) down

reset: ## Stop everything and delete all data, then start fresh
	$(COMPOSE) down --volumes --remove-orphans
	@$(MAKE) --no-print-directory up

doctor: ## Check that every part of the stack is working
	@bin/doctor.sh

traffic: ## Send a set of test prompts to the agent (ROUNDS=n to repeat)
	$(COMPOSE) exec -T -e TRAFFIC_ROUNDS=$(or $(ROUNDS),1) app npm run -s traffic

collector-restart: ## Restart the OpenTelemetry Collector after editing its config
	$(COMPOSE) restart otel-collector
	@for i in $$(seq 1 60); do curl -sf localhost:$(or $(COLLECTOR_HEALTH_PORT),13133) >/dev/null && echo "Collector is up." && exit 0; sleep 1; done; \
	  echo "Collector did not come up. Check: $(COMPOSE) logs otel-collector"; exit 1

solution: ## Apply a lab's solution: make solution LAB=2
	@case "$(LAB)" in \
	  2) cp labs/solutions/lab2/config.yaml infra/otel-collector/config.yaml && $(MAKE) --no-print-directory collector-restart ;; \
	  3) cp labs/solutions/lab3/guardrails.ts app/src/app/lib/guardrails.ts && echo "Applied. The app hot-reloads; run make traffic." ;; \
	  *) echo "Usage: make solution LAB=2|3 (labs 1 and 4 have no code changes)"; exit 1 ;; \
	esac

lab-reset: ## Put the lab files back to their TODO state
	git checkout -- infra/otel-collector/config.yaml app/src/app/lib/guardrails.ts
	@$(MAKE) --no-print-directory collector-restart

semconv: ## Switch the agent to the AI SDK's native GenAI semconv telemetry
	AI_TELEMETRY=semconv $(COMPOSE) up -d --wait app
	@$(MAKE) --no-print-directory warm

legacy: ## Switch the agent back to the AI SDK's legacy ai.* telemetry
	AI_TELEMETRY=legacy $(COMPOSE) up -d --wait app
	@$(MAKE) --no-print-directory warm

# The app runs `next dev` (so Lab 3 hot-reloads), which compiles each route on its first request.
# Do that now rather than on the attendee's first question. A GET to /api/chat compiles it (405).
warm:
	@echo "Warming up the travel planner (the first compile can take a minute or two)..."
	@curl -s -o /dev/null --max-time 300 $(APP_URL)/ || true
	@curl -s -o /dev/null --max-time 300 $(APP_URL)/api/chat || true

logs: ## Follow the app and collector logs
	$(COMPOSE) logs -f app otel-collector

urls: ## Print the URLs you need
	@echo ""
	@echo "  Travel planner  http://localhost:$(or $(APP_PORT),3000)"
	@echo "  Kibana          $(KIBANA_URL)   (elastic / $(or $(ELASTIC_PASSWORD),changeme))"
	@echo "  Prometheus      http://localhost:$(or $(PROMETHEUS_PORT),9090)"
	@echo ""

export: ## Export your dashboards to my-agent-dashboard.ndjson (Lab 4)
	@curl -sf -u $(ES_AUTH) -X POST "$(KIBANA_URL)/api/saved_objects/_export" \
	  -H 'kbn-xsrf: true' -H 'Content-Type: application/json' \
	  -d '{"type":["dashboard"],"includeReferencesDeep":true,"excludeExportDetails":true}' \
	  -o my-agent-dashboard.ndjson && echo "Wrote my-agent-dashboard.ndjson ($$(grep -c . my-agent-dashboard.ndjson) dashboards)"
	@echo "Re-import it anywhere: Kibana > Stack Management > Saved objects > Import."
