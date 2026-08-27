# Coffee Chat Roastery

> Data home for source Origins and explicitly confirmed perspective Beans used
> by Coffee Chat.

## Essence

Source material and a person's confirmed perspective are different kinds of
truth. Roastery keeps them separate so a Product Skill cannot silently turn an
AI interpretation into the person's view.

## Role

Roastery is Coffee Chat's data home. It owns Origins and explicitly confirmed
Beans; the Product owns Skills, Bench owns measurement criteria, and Eval owns
execution evidence.

## Goal

Keep the source that grounds a perspective and the exact perspective the owner
approved available for later Brew use, without prematurely deciding a storage
schema or publication workflow.

## Why

People already express what they value and how they judge events, work, and
choices in public posts, documents, conversations, and other records. Those
records are useful source material, but an AI interpretation is not
automatically the person's view. Roastery keeps the source and the confirmed
perspective separate so Product Skills can evolve without silently changing
what a user approved.

## What

### Origin

An Origin is source material: a public post, document, transcript, URL, event,
conversation, decision, or user-provided context. It may contain facts and
opinions. It is not a confirmed Coffee Chat perspective.

### Bean

A Bean is a perspective record refined from one or more Origins. It preserves
the factual context needed to understand the perspective, including priorities,
trade-offs, judgment boundaries, and uncertainty. It becomes authoritative only
after the user reviews and explicitly confirms its exact meaning.

An unreviewed AI candidate is not a Bean. Coffee produced by Brew is not
automatically a Bean.

## How

Roast proposes a candidate from one or more Origins. The owner reviews and
explicitly confirms its exact meaning; only then does Roastery accept it under
`beans/`. Brew reads that confirmed record as input but does not change it.
Taste is the effect of applying a Bean, not a second stored record.

## Lifecycle

~~~text
Origin -> Roast -> candidate -> explicit confirmation -> Bean -> Brew -> Coffee
~~~

Roastery stores the source and confirmed result. Roast, Brew, Product behavior,
benchmark criteria, and evaluation evidence belong to sibling repositories.

## Repository layout

~~~text
coffee-chat-roastery/
├── README.md
├── origins/
│   └── .gitkeep
└── beans/
    └── .gitkeep
~~~

The directories are semantic boundaries, not a schema or filename contract.
Storage format, provenance fields, indexes, access control, and publication
policy remain open until product and evaluation evidence require them.

## Ownership boundary

This repository does not contain the Coffee Chat Plugin, Roast or Brew
instructions, unconfirmed candidates, generated Coffee, benchmark cases,
Ground Truth, Judge results, execution traces, credentials, or indexes.

The official repository is a data-free seed. Personal Origins and Beans belong
to the owner-controlled Roastery instance and must not be added here.

## Status

The semantic data home is defined, but no storage schema, publication flow, or
Product behavior is implemented or measured in this repository.

## License

Repository code and documentation are MIT licensed, Copyright © 2026 Openboa
AI. Origin and Bean content rights are determined by the owner and the policy
of the applicable Roastery instance.
