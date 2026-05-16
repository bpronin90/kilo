# Expo Go On Phone From WSL

Use this when the Kilo Expo app is run from WSL and loaded in Expo Go on a phone.

## TL;DR

1. In WSL, start Expo:

```bash
cd /home/benpronin/projects/kilo/mobile
npx expo start --clear
```

2. Copy the WSL Expo IP from:

```text
Metro waiting on exp://172.xx.xx.xx:8081
```

3. In Windows PowerShell, get the Windows Wi-Fi IP:

```powershell
ipconfig
```

4. In Windows PowerShell as Administrator, forward Windows port `8081` to the WSL IP:

```powershell
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=8081
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8081 connectaddress=172.xx.xx.xx connectport=8081
netsh advfirewall firewall add rule name="Expo 8081" dir=in action=allow protocol=TCP localport=8081
```

5. In Expo Go on the phone, manually open:

```text
exp://<windows-wifi-ip>:8081
```

If it stops working later, the WSL `172.x.x.x` IP probably changed. Re-run the port-forward commands with the new WSL IP.

## Normal Start

From WSL:

```bash
cd /home/benpronin/projects/kilo/mobile
npx expo start --clear
```

Expo will usually print something like:

```text
Metro waiting on exp://172.xx.xx.xx:8081
```

If that address is `172.x.x.x`, it is a WSL-internal IP and the phone usually cannot reach it directly.

## Working WSL Fix

1. Leave Expo running in WSL.
2. In Windows PowerShell, find the Windows Wi-Fi IPv4 address:

```powershell
ipconfig
```

3. In Windows PowerShell as Administrator, remove any old port forward:

```powershell
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=8081
```

4. In Windows PowerShell as Administrator, forward Windows port `8081` to the WSL Expo IP.
   Replace `172.xx.xx.xx` with the current WSL IP shown by Expo:

```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8081 connectaddress=172.xx.xx.xx connectport=8081
```

5. In Windows PowerShell as Administrator, allow the port through the firewall:

```powershell
netsh advfirewall firewall add rule name="Expo 8081" dir=in action=allow protocol=TCP localport=8081
```

6. In Expo Go on the phone, manually open:

```text
exp://<windows-wifi-ip>:8081
```

Example:

```text
exp://192.168.1.50:8081
```

## If It Spins Forever

- Confirm phone and laptop are on the same Wi-Fi.
- Force-close Expo Go and reopen it.
- Verify Expo is still running in WSL.
- Check whether the WSL IP changed.

If WSL restarted, the `172.x.x.x` IP may change. When that happens:

1. Stop using the old forward.
2. Re-run the `portproxy delete` command.
3. Re-run the `portproxy add` command with the new WSL IP.

## Dependency Note

Do not use:

```bash
npm audit fix --force
```

for this workflow. It can rewrite Expo/Jest versions and break the repo's intended dependency set without fixing the WSL phone-connectivity problem.
