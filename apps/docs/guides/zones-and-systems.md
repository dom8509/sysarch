# Zones and systems

Both group components, but they serve different purposes:

| | `zone` | `system` |
|---|---|---|
| Purpose | **layout** band along the flow direction | **semantic** boundary: ECU, domain, vehicle |
| Nesting | top level only | anywhere, including inside zones |
| Rendering | labeled band with a subtle background | labeled frame |

## Zones: the signal flow as bands

Zones appear in the order in which they are written — with `direction LR` as columns from
left to right, with `direction TB` as rows from top to bottom.

```sysarch
architecture "Signal Chain" {
    direction LR

    zone input {
        label "Sensing"
        component temp: sensor { label "Temperature" }
        component pos: sensor { label "Position" }
    }

    zone processing {
        label "Processing"
        component mcu: microcontroller
    }

    zone output {
        label "Actuation"
        component heater: load { label "Heater" }
        component motor: motor
    }

    temp -> mcu   { type analog }
    pos -> mcu    { type digital }
    mcu -> heater { type pwm }
    mcu -> motor  { type pwm }
}
```

::: warning All or nothing
Once you use zones, **every** component has to live in a zone. Otherwise sysarch reports
[E106](/reference/diagnostics#e106).
:::

## Systems: showing boundaries

A `system` frames what belongs together — independently of the layout. Systems can be nested
and may live inside zones.

```sysarch
architecture "Vehicle Network" {
    direction LR

    system vehicle {
        label "Vehicle"
        system bcm {
            label "Body Control Module"
            component mcu: microcontroller { label "RH850" }
            component can: can_transceiver
        }
        component door: external_ecu { label "Door ECU" }
    }
    component cloud: external_ecu { label "Backend" }

    mcu -> can.TXD
    can.CANH <-> door { type can }
    door -> cloud     { label "Telematics" type ethernet }
}
```

The structure is always a tree: `architecture › zone › system … › component`. A component
belongs to the innermost block it is written in, and its ID is unique across the whole
document.

## Connections inside a system

A system carries the connections between its own components. In a document with a handful of
ECUs, a single list of connections at the bottom no longer says which ECU it describes —
written inside the system, the wiring stays with the thing it wires:

```sysarch
architecture "Vehicle Network" {
    direction LR

    system bcm {
        label "Body Control Module"
        component mcu: microcontroller { label "RH850" }
        component can: can_transceiver

        mcu -> can.TXD
    }

    component door: external_ecu { label "Door ECU" }

    can.CANH <-> door { type can }
}
```

Where a connection is written changes nothing about the diagram: IDs are unique across the
whole document, and the connection is laid out, routed and exported exactly as if it stood in
the architecture. It is a matter of reading order, and `sysarch fmt` keeps it one: inside a
system the connections come after the components, separated by a blank line.

Both endpoints have to belong to the system — components of nested systems count as its own.
A connection that crosses the system boundary is not the system's own business and belongs to
the architecture; otherwise sysarch reports
[W206](/reference/diagnostics#w206). A `zone` never carries connections: it is a band in the
layout, not a boundary in the model.
