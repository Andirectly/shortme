# ShortMeHardwareProbe — executable starter, **not** Mac-tested here

Requires Apple macOS 14+, Xcode / Swift tools installed.

```bash
cd starter/HardwareProbe
swift build -c release
swift run -c release shortme-hardware-probe > /tmp/shortme-hardware.json
python3 ../policy/hardware_policy.py /tmp/shortme-hardware.json
```

This intentionally does not guess free RAM. `memory_pressure` starts as `unknown`. The actual app must subscribe to `DispatchSourceMemoryPressure`, re-evaluate after each stage, and serialize heavy models for 16GB. Do **not** infer free memory from `MTLDevice.recommendedMaxWorkingSetSize`; that value is a guidance working-set ceiling, not available bytes.

The source is a hardware-detection *starter*. Actual macOS compilation, Apple Silicon runtime readings, memory-pressure callbacks, Metal output and Xcode signing need real Mac testing. Do not treat Linux/Python tests as that proof.
